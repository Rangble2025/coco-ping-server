import http from "http";
import { WebSocketServer } from "ws";

const server = http.createServer((req, res) => {
  // ✅ Render용 헬스 체크 (필수)
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("coco ping server alive");
    return;
  }

  // 나머지는 404
  res.writeHead(404);
  res.end();
});

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
}

wss.on("connection", (ws) => {
  ws.on("message", (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      return;
    }

    if (
      msg?.type !== "PING" ||
      typeof msg.roomId !== "string" ||
      !msg.payload
    ) return;

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
      if (client.readyState === 1) {
        client.send(out);
      }
    }
  });

  ws.on("close", () => leave(ws));
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, "0.0.0.0", () => {
  console.log("HTTP + WS server listening on", PORT);
});

wss.on("connection", (ws) => {
  console.log("✅ client connected");

  ws.on("message", (buf) => {
    console.log("📩 recv:", buf.toString());
  
  });
});
