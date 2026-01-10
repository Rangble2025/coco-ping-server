/**
 * coco-ping-server (Render)
 * - 같은 roomId 안에서 PING 메시지를 모두에게 브로드캐스트
 * - JOIN 메시지로 "접속자 수"를 미리 반영(핑 안 찍어도 방에 들어옴)
 * - /health 로 HTTP 헬스 체크 응답
 * - 로그를 자세히 찍어서 문제 지점 파악
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

/** HTTP (Render 포트/헬스 체크 대응) */
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

wss.on("connection", (ws, req) => {
  const ip =
    req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown";

  ws._ip = ip;
  ws._id = Math.random().toString(16).slice(2, 10);

  console.log(`✅ connected id=${ws._id} ip=${ip}`);

  ws.on("message", (buf) => {
    const raw = buf.toString("utf8");
    console.log("[WS] message:", s.slice(0, 300));
    });
    ws.on("close", (code, reason) => {
    console.log("[WS] close", code, reason?.toString?.() || "");
    });
    ws.on("error", (e) => console.log("[WS] error", e));

    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      console.log(`❌ bad json id=${ws._id} raw=${raw.slice(0, 200)}`);
      return;
    }

    // 공통 roomId 검증
    const roomId = msg?.roomId;
    if (typeof roomId !== "string" || !roomId) {
      console.log(`⚠️ ignore missing roomId id=${ws._id} type=${msg?.type}`);
      return;
    }

    // JOIN: 방 등록만 하고 끝(브로드캐스트 없음)
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

    // PING: payload를 방 전체에 브로드캐스트
    if (msg.type !== "PING") {
      // 노이즈 타입은 조용히 무시(로그 스팸 방지)
      return;
    }

    if (!msg.payload || typeof msg.payload !== "object") {
      console.log(`⚠️ ignore missing payload id=${ws._id} room=${roomId}`);
      return;
    }

    // 방 join / switch (PING만 보내도 자동 join 되게)
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

server.listen(PORT, () => {
  console.log("HTTP + WS server listening on", PORT);
});

function heartbeat() { this.isAlive = true; }

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", heartbeat);
});

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 25000);
