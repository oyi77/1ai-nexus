import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { authMiddleware } from "./auth";
import WebSocket from "ws";
import { startSubscriber } from "./subscriber";
const PORT = parseInt(process.env.WS_PORT || "4401", 10);
const ALLOWED_ORIGINS = [
  'https://tracker.aitradepulse.com',
  'http://localhost:4400',
  'http://localhost:3000',
];
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
  },
  pingInterval: 30000,
  pingTimeout: 10000,
  transports: ["websocket", "polling"],
});

// Health check endpoint
app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// Apply auth middleware to all namespaces
const namespaces = ["/trades", "/alerts", "/prices", "/flows", "/cex"];

for (const ns of namespaces) {
  const namespace = io.of(ns);
  namespace.use(authMiddleware);

  namespace.on("connection", (socket) => {
    console.log(`[WS] Client connected to ${ns}: ${socket.id}`);

    // Allow clients to join specific rooms
    socket.on("join", (room: string) => {
      socket.join(room);
      console.log(`[WS] ${socket.id} joined room ${room}`);
    });

    socket.on("leave", (room: string) => {
      socket.leave(room);
      console.log(`[WS] ${socket.id} left room ${room}`);
    });

    socket.on("disconnect", (reason) => {
      console.log(`[WS] Client disconnected from ${ns}: ${socket.id} (${reason})`);
    });
  });
}

// ─── Orderbook Depth Stream (public, no auth) ──────────────
// Single upstream Binance WS per symbol → broadcasts to all clients
import WebSocket from "ws";

const DEPTH_SYMBOLS = ["btcusdt", "ethusdt", "solusdt", "xrpusdt", "dogeusdt", "avaxusdt", "linkusdt", "arbusdt", "opusdt"]
const depthStreams = new Map<string, WebSocket>()
const orderbookNs = io.of("/orderbook")

function connectDepthStream(symbol: string) {
  if (depthStreams.has(symbol)) return
  const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol}@depth20@100ms`)
  depthStreams.set(symbol, ws)

  ws.on("open", () => console.log(`[orderbook-ws] ${symbol} connected`))

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString())
      // Broadcast to all clients subscribed to this symbol room
      orderbookNs.to(symbol).emit("depth", { symbol, bids: msg.bids, asks: msg.asks, timestamp: Date.now() })
    } catch {}
  })

  ws.on("error", () => console.warn(`[orderbook-ws] ${symbol} error`))
  ws.on("close", () => {
    depthStreams.delete(symbol)
    console.log(`[orderbook-ws] ${symbol} disconnected, reconnecting in 3s...`)
    setTimeout(() => connectDepthStream(symbol), 3000)
  })
}

// Start all depth streams
for (const sym of DEPTH_SYMBOLS) connectDepthStream(sym)

// Handle client connections — no auth required for orderbook
orderbookNs.on("connection", (socket) => {
  console.log(`[orderbook-ws] Client connected: ${socket.id}`)
  socket.on("subscribe", (symbol: string) => {
    const normalized = symbol.toLowerCase().replace("usdt", "") + "usdt"
    socket.join(normalized)
    console.log(`[orderbook-ws] ${socket.id} subscribed to ${normalized}`)
  })
  socket.on("unsubscribe", (symbol: string) => {
    const normalized = symbol.toLowerCase().replace("usdt", "") + "usdt"
    socket.leave(normalized)
  })
  socket.on("disconnect", () => console.log(`[orderbook-ws] Client disconnected: ${socket.id}`))
})

// ─── Start Redis subscriber ────────────────────────────────
const subscriber = startSubscriber(io);

httpServer.listen(PORT, () => {
  console.log(`[WS] Socket.io server running on port ${PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("[WS] Shutting down...");
  await subscriber.quit();
  io.close();
  httpServer.close();
  process.exit(0);
});
