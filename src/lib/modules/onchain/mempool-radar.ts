// ─────────────────────────────────────────────────────────────
// Module: Mempool Radar
// sourceType: public-api
// Endpoint: blockstream.info/api
// Coverage: Bitcoin mempool — pending txs, whale detection, fees
// ─────────────────────────────────────────────────────────────

const BASE = 'https://blockstream.info/api'

const WHALE_THRESHOLD_SAT = 10_000_000_000 // ~$100K at ~$100K BTC
const SATS_PER_BTC = 100_000_000

// ── In-memory cache (10s TTL — mempool changes fast) ────────

interface CacheEntry<T> { data: T; expires: number }
const cache = new Map<string, CacheEntry<unknown>>()
const CACHE_TTL = 10_000

function getCached<T>(key: string): T | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (Date.now() > entry.expires) { cache.delete(key); return undefined }
  return entry.data as T
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, expires: Date.now() + CACHE_TTL })
}

// ── Fetch helpers ───────────────────────────────────────────

async function blockstreamFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Blockstream ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

// ── Types ───────────────────────────────────────────────────

export interface MempoolStats {
  count: number
  vsize: number       // virtual bytes
  totalFee: number    // total fees in satoshis
  feeHistogram: [number, number][]  // [fee_rate, vsize] pairs
}

export interface RecentTx {
  txid: string
  fee: number         // satoshis
  vsize: number
  value: number       // estimated BTC value (satoshis)
  rate: number        // sat/vB
  age: number         // seconds since first seen
}

export interface WhalePendingTx {
  txid: string
  fee: number
  vsize: number
  valueBtc: number
  valueUsd: number
  rate: number
  age: number
}

export interface FeeLevel {
  label: string
  range: string
  rate: number
}

// ── Public API ──────────────────────────────────────────────

export async function getMempoolStats(): Promise<MempoolStats> {
  const key = 'mempool-stats'
  const cached = getCached<MempoolStats>(key)
  if (cached) return cached

  const stats = await blockstreamFetch<MempoolStats>('/mempool')
  setCache(key, stats)
  return stats
}

export async function getRecentMempoolTxs(): Promise<RecentTx[]> {
  const key = 'mempool-recent'
  const cached = getCached<RecentTx[]>(key)
  if (cached) return cached

  const txs = await blockstreamFetch<RecentTx[]>('/mempool/recent')
  setCache(key, txs)
  return txs
}

export async function getWhalePendingTxs(): Promise<WhalePendingTx[]> {
  const key = 'mempool-whale'
  const cached = getCached<WhalePendingTx[]>(key)
  if (cached) return cached

  const txs = await getRecentMempoolTxs()
  const now = Date.now() / 1000

  // Estimate BTC price from fee histogram (rough: assume ~$100K for threshold)
  // We filter by satoshi value directly — WHALE_THRESHOLD_SAT ≈ 10 BTC
  const whales: WhalePendingTx[] = txs
    .filter(tx => tx.value >= WHALE_THRESHOLD_SAT)
    .map(tx => ({
      txid: tx.txid,
      fee: tx.fee,
      vsize: tx.vsize,
      valueBtc: tx.value / SATS_PER_BTC,
      valueUsd: (tx.value / SATS_PER_BTC) * estimateBtcPrice(),
      rate: tx.rate,
      age: tx.age,
    }))
    .sort((a, b) => b.valueBtc - a.valueBtc)

  setCache(key, whales)
  return whales
}

export async function getFeeLevels(): Promise<FeeLevel[]> {
  const key = 'fee-levels'
  const cached = getCached<FeeLevel[]>(key)
  if (cached) return cached

  const fees = await blockstreamFetch<{ fastestFee: number; halfHourFee: number; hourFee: number; economyFee: number; minimumFee: number }>('/fee-estimates')
  const levels: FeeLevel[] = [
    { label: 'Fast', range: '~10 min', rate: fees.fastestFee },
    { label: 'Med', range: '~30 min', rate: fees.halfHourFee },
    { label: 'Low', range: '~60 min', rate: fees.hourFee },
    { label: 'Economy', range: 'bulk', rate: fees.economyFee },
  ]
  setCache(key, levels)
  return levels
}

export interface CongestionLevel {
  level: 'low' | 'medium' | 'high' | 'extreme'
  label: string
  color: string
}

export function getCongestionLevel(txCount: number): CongestionLevel {
  if (txCount < 10_000) return { level: 'low', label: 'Low', color: 'text-data-bull' }
  if (txCount < 50_000) return { level: 'medium', label: 'Medium', color: 'text-data-warn' }
  if (txCount < 150_000) return { level: 'high', label: 'High', color: 'text-orange-500' }
  return { level: 'extreme', label: 'Extreme', color: 'text-data-bear' }
}

// ── Helpers ─────────────────────────────────────────────────

let cachedBtcPrice = 100_000 // fallback BTC price for USD estimates

function estimateBtcPrice(): number {
  // Refresh price every 5 minutes from the fee market signals
  // For now use a reasonable default — the mempool data is the signal
  return cachedBtcPrice
}
