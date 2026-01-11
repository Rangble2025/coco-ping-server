/**
 * coco-ping-server (Render)
 * - 같은 roomId 안에서 PING 메시지를 모두에게 브로드캐스트
 * - JOIN 메시지로 "접속자 수"를 미리 반영(핑 안 찍어도 방에 들어옴)
 * - /health 로 HTTP 헬스 체크 응답
 * - 메시지 저장 없음(브로드캐스트만)
 * - ping/pong 하트비트로 유령 연결 정리
 */

import http from "http";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || 10000);

/** roomId -> Set<WebSocket> */
const rooms = new Map();

function roomSize(roomId) {
  return rooms.get(roomId)?.size ?? 0;
}

function join(ws, roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Set());
  rooms.get(roomId).add(ws);
  ws._roomId = roomId;

  console.log(`➡️ join room=${roomId} size=${roomSize(roomId)}`);
}

function leave(ws) {
  const roomId = ws._roomId;
  if (!roomId) return;

  const set = rooms.get(roomId);
  if (!set) return;

  set.delete(ws);
  if (set.size === 0) rooms.delete(roomId);

  console.log(`⬅️ leave room=${roomId} size=${roomSize(roomId)}`);
}

/** HTTP (Render 헬스체크 대응) */
const server = http.createServer((req, res) => {
  const url = req.url || "/";

  if (url === "/" || url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ok");
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("not found");
});

/** WebSocket (/ws) */
const wss = new WebSocketServer({ server, path: "/ws" });

/** pong 받으면 살아있다고 표시 */
function heartbeat() {
  this.isAlive = true;
}

wss.on("connection", (ws, req) => {
  // 접속자 식별용(로그)
  const ip =
    req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown";

  ws._ip = ip;
  ws._id = Math.random().toString(16).slice(2, 10);

  // 하트비트 초기화
  ws.isAlive = true;
  ws.on("pong", heartbeat);

  console.log(`✅ connected id=${ws._id} ip=${ip}`);

  ws.on("message", (buf) => {
    const raw = buf.toString("utf8");

    // 로그가 너무 길어지는 걸 방지(앞부분만)
    console.log("[WS] message:", raw.slice(0, 300));

    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      console.log(`❌ bad json id=${ws._id} raw=${raw.slice(0, 200)}`);
      return;
    }

    // roomId 검증
    const roomId = msg?.roomId;
    if (typeof roomId !== "string" || !roomId) {
      console.log(`⚠️ ignore missing roomId id=${ws._id} type=${msg?.type}`);
      return;
    }

    // JOIN: 방만 등록(브로드캐스트 없음)
    if (msg.type === "JOIN") {
      if (!ws._roomId) join(ws, roomId);
      if (ws._roomId !== roomId) {
        console.log(`🔁 switch room id=${ws._id} ${ws._roomId} -> ${roomId}`);
        leave(ws);
        join(ws, roomId);
      }
      console.log(`👋 JOIN ok id=${ws._id} room=${roomId} size=${roomSize(roomId)}`);
      return;
    }

    // PING만 처리 (다른 타입은 조용히 무시)
    if (msg.type !== "PING") return;

    // payload 검증
    if (!msg.payload || typeof msg.payload !== "object") {
      console.log(`⚠️ ignore missing payload id=${ws._id} room=${roomId}`);
      return;
    }

    // PING만 보내도 자동 join 되게 처리
    if (!ws._roomId) join(ws, roomId);
    if (ws._roomId !== roomId) {
      console.log(`🔁 switch room id=${ws._id} ${ws._roomId} -> ${roomId}`);
      leave(ws);
      join(ws, roomId);
    }

    const set = rooms.get(ws._roomId);
    if (!set) {
      console.log(`⚠️ room set missing? id=${ws._id} room=${ws._roomId}`);
      return;
    }

    // 서버는 저장 안 하고 그대로 재브로드캐스트만 함
    const outObj = { type: "PING", roomId, payload: msg.payload };
    const out = JSON.stringify(outObj);

    console.log(
      `📨 recv PING id=${ws._id} room=${roomId} size=${set.size} ` +
      `payloadKeys=${Object.keys(msg.payload).join(",")}`
    );

    let sent = 0;
    for (const client of set) {
      if (client.readyState === 1) {
        client.send(out);
        sent++;
      }
    }

    console.log(`📤 broadcast room=${roomId} sent=${sent}/${set.size}`);
  });

  ws.on("close", (code, reason) => {
    console.log(`🛑 closed id=${ws._id} code=${code} reason=${reason?.toString?.() || ""}`);
    leave(ws);
  });

  ws.on("error", (e) => {
    console.log(`💥 ws error id=${ws._id} err=${e?.message || e}`);
  });
});

// Render에서 반드시 listen 해야 함
server.listen(PORT, () => {
  console.log("HTTP + WS server listening on", PORT);
});

// 25초마다 ping -> pong 없으면 terminate (유령 연결 정리)
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 25000);

wss.on("close", () => clearInterval(interval));
