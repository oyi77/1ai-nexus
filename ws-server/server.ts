import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { authMiddleware } from "./auth";
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

// Start Redis subscriber
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
