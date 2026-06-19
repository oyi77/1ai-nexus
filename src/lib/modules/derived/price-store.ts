// ─────────────────────────────────────────────────────────────
// Historical Price Store — In-memory ring buffer + API
// Stores price snapshots for OHLCV computation
// No external DB dependency — survives process lifetime
// ponytail: in-memory ring buffer, move to Redis/Postgres when >10K symbols
// ─────────────────────────────────────────────────────────────

export interface PriceSnapshot {
  symbol: string
  price: number
  volume24h: number
  marketCap: number
  change24h: number
  timestamp: number
}

export interface OhlcvCandle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

const MAX_SNAPSHOTS = 10_000
const snapshots: PriceSnapshot[] = []
const snapshotsBySymbol = new Map<string, PriceSnapshot[]>()

export function recordSnapshot(snap: PriceSnapshot) {
  snapshots.push(snap)
  if (snapshots.length > MAX_SNAPSHOTS) snapshots.shift()

  const arr = snapshotsBySymbol.get(snap.symbol) ?? []
  arr.push(snap)
  // Keep last 1000 per symbol
  if (arr.length > 1000) arr.shift()
  snapshotsBySymbol.set(snap.symbol, arr)
}

export function getSnapshots(symbol: string, since?: number): PriceSnapshot[] {
  const arr = snapshotsBySymbol.get(symbol) ?? []
  if (!since) return arr
  return arr.filter(s => s.timestamp >= since)
}

export function getLatestPrice(symbol: string): PriceSnapshot | undefined {
  const arr = snapshotsBySymbol.get(symbol)
  return arr?.[arr.length - 1]
}

export function getAllLatest(): Map<string, PriceSnapshot> {
  const latest = new Map<string, PriceSnapshot>()
  for (const [symbol, arr] of snapshotsBySymbol) {
    if (arr.length > 0) latest.set(symbol, arr[arr.length - 1])
  }
  return latest
}

/** Build OHLCV candles from snapshots */
export function buildOhlcv(symbol: string, intervalMs: number, limit = 100): OhlcvCandle[] {
  const arr = snapshotsBySymbol.get(symbol) ?? []
  if (arr.length === 0) return []

  const candles: OhlcvCandle[] = []
  const now = Date.now()
  const start = now - (limit * intervalMs)

  for (let i = 0; i < limit; i++) {
    const candleStart = start + (i * intervalMs)
    const candleEnd = candleStart + intervalMs
    const inRange = arr.filter(s => s.timestamp >= candleStart && s.timestamp < candleEnd)

    if (inRange.length === 0) {
      // Use last known price for empty candles
      const lastPrice = candles.length > 0 ? candles[candles.length - 1].close : (arr[0]?.price ?? 0)
      candles.push({ time: Math.floor(candleStart / 1000), open: lastPrice, high: lastPrice, low: lastPrice, close: lastPrice, volume: 0 })
    } else {
      candles.push({
        time: Math.floor(candleStart / 1000),
        open: inRange[0].price,
        high: Math.max(...inRange.map(s => s.price)),
        low: Math.min(...inRange.map(s => s.price)),
        close: inRange[inRange.length - 1].price,
        volume: inRange.reduce((sum, s) => sum + s.volume24h, 0),
      })
    }
  }

  return candles
}

export function getSnapshotCount(): number {
  return snapshots.length
}

export function getSymbolCount(): number {
  return snapshotsBySymbol.size
}
