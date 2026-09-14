import Redis from "ioredis";

// Redis publisher for Telegram alert bridge
export const alertRedis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
  retryStrategy(times) { return Math.min(times * 200, 5000) },
})

// ─── Public namespaces (no auth, browser-facing) ────────────
export const DEPTH_SYMBOLS = [
  "btcusdt", "ethusdt", "solusdt", "xrpusdt", "dogeusdt",
  "avaxusdt", "linkusdt", "arbusdt", "opusdt", "maticusdt",
  "adausdt", "dotusdt", "ltcusdt", "bchusdt", "uniusdt",
  "aaveusdt", "atomusdt", "nearusdt", "aptusdt", "suiusdt",
  "pepeusdt", "wifusdt", "jupusdt", "tiausdt", "injusdt",
  "ftmusdt", "sandusdt", "manausdt", "galausdt", "blurusdt",
]

export let activeStreams = 0
export function getActiveStreams(): number { return activeStreams }
export function incStreams(): void { activeStreams++ }
export function decStreams(): void { activeStreams-- }
