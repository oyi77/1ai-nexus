import { authMiddleware } from './auth'
import { startSubscriber } from './subscriber'
import { io, app, httpServer, PORT } from './io'
import { DEPTH_SYMBOLS, getActiveStreams } from './shared'
import { connectDepth, connectTicker, connectTradeStream, connectFuturesTicker, connectLiquidations } from './binance'
import { startAllDexStreams } from './memecoins'

// Global error handlers — prevent Redis crashes from taking down the server
process.on('uncaughtException', (err) => {
  console.error('[WS] Uncaught exception (non-fatal):', err.message)
})
process.on('unhandledRejection', (reason) => {
  if (reason && (reason as Error).message?.includes('Redis') || (reason as Error).message?.includes('ioredis')) {
    // Redis errors are non-fatal — ignore to prevent crash
    return
  }
  console.error('[WS] Unhandled rejection:', reason)
})

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), streams: getActiveStreams() });
});

// ─── Auth-protected namespaces ──────────────────────────────
const authNamespaces = ["/trades", "/alerts", "/flows", "/cex"];
for (const ns of authNamespaces) {
  const namespace = io.of(ns);
  namespace.use(authMiddleware);
  namespace.on("connection", (socket) => {
    console.log(`[WS] Client connected to ${ns}: ${socket.id}`);
    socket.on("join", (room: string) => { socket.join(room); });
    socket.on("leave", (room: string) => { socket.leave(room); });
    socket.on("disconnect", () => {});
  });
}
// ═══════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════
for (const sym of DEPTH_SYMBOLS) connectDepth(sym)
connectTicker()
connectTradeStream()
connectFuturesTicker()
connectLiquidations()
startAllDexStreams()

const subscriber = startSubscriber(io);

httpServer.listen(PORT, () => {
  console.log(`[WS] Socket.io server on port ${PORT}`);
  console.log(`[WS] Streams: orderbook(${DEPTH_SYMBOLS.length}), prices, derivatives, liquidations, arbitrage`);
});

process.on("SIGTERM", async () => {
  console.log("[WS] Shutting down...");
  await subscriber.legacy.quit();
  io.close();
  httpServer.close();
  process.exit(0);
});
