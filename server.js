import http from "http";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT) || 8080;

// ✅ Render 포트 스캔/헬스체크 대응: HTTP 응답 추가
const server = http.createServer((req, res) => {
  // 간단한 헬스체크 페이지
  if (req.url === "/" || req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("coco-ping-server alive");
    return;
  }

  // ws는 업그레이드 핸들링을 ws 라이브러리가 함
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("not found");
});

// ✅ WebSocket 경로 유지
const wss = new WebSocketServer({ server, path: "/ws" });

// roomId -> Set<ws>
const rooms = new Map();

function join(ws, roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Set());
  rooms.get(roomId).add(ws);
  ws._roomId = roomId;
}

function leave(ws) {
  const roomId = ws._roomId;
  if (!roomId) return;
  const set = rooms.get(roomId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) rooms.delete(roomId);
  ws._roomId = null;
}

wss.on("connection", (ws) => {
  ws.on("message", (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      return;
    }

    if (msg?.type !== "PING" || typeof msg.roomId !== "string" || !msg.payload) return;

    if (!ws._roomId) join(ws, msg.roomId);
    if (ws._roomId !== msg.roomId) {
      leave(ws);
      join(ws, msg.roomId);
    }

    const set = rooms.get(ws._roomId);
    if (!set) return;

    const out = JSON.stringify({
      type: "PING",
      roomId: msg.roomId,
      payload: msg.payload,
    });

    for (const client of set) {
      if (client.readyState === 1) client.send(out);
    }
  });

  ws.on("close", () => leave(ws));
});

// ✅ Render에서 필수: PORT로 리슨 + 0.0.0.0 바인딩 권장
server.listen(PORT, "0.0.0.0", () => {
  console.log("HTTP+WS server listening on port", PORT);
  console.log("WS path:", "/ws");
});
