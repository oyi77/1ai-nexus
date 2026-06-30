// Token scoring engine for real-time meme token hype detection
// Used by ws-server to score newly detected tokens across all chains

export interface ScoredToken {
  address: string
  chain: string
  name: string
  symbol: string
  priceUsd: number
  fdv: number
  liquidity: number
  volume24h: number
  boosts: number
  age: number // seconds since detected
  score: number // 0-100 hype score
  risk: 'low' | 'medium' | 'high' | 'extreme'
  sources: string[]
  firstSeen: number
  swapCount: number
}

export interface ScoredTokenInput {
  address: string
  chain: string
  name?: string
  symbol?: string
  priceUsd?: number
  fdv?: number
  liquidity?: number
  volume24h?: number
  boosts?: number
  sources?: string[]
  swapCount?: number
}

interface TokenCacheEntry extends ScoredTokenInput {
  address: string
  chain: string
  firstSeen: number
}

// In-memory registry — runtime collection, Map is correct
const tokenRegistry = new Map<string, TokenCacheEntry>()
const PRUNE_THRESHOLD = 2500 // max entries before cleanup
const MAX_AGE_MS = 48 * 3_600_000 // 48 hours

// Periodically remove entries older than 48h to prevent unbounded growth
function pruneRegistry(now: number): void {
  const cutoff = now - MAX_AGE_MS
  for (const [addr, entry] of tokenRegistry) {
    if (entry.firstSeen < cutoff) tokenRegistry.delete(addr)
  }
}

export function getTokenRegistrySize(): number {
  return tokenRegistry.size
}

export function resetTokenRegistry(): void {
  tokenRegistry.clear()
}

export { tokenRegistry }

export function scoreToken(token: ScoredTokenInput, now: number = Date.now()): ScoredToken {
  const existing = tokenRegistry.get(token.address)
  const firstSeen = existing?.firstSeen ?? now
  const ageHours = (now - firstSeen) / 3_600_000

  let score = 0
  // Prune stale entries when registry exceeds threshold
  if (tokenRegistry.size > PRUNE_THRESHOLD) pruneRegistry(now)
  const boosts = token.boosts ?? existing?.boosts ?? 0
  const liquidity = token.liquidity ?? existing?.liquidity ?? 0
  const fdv = token.fdv ?? existing?.fdv ?? 0
  const volume24h = token.volume24h ?? existing?.volume24h ?? 0
  const swapCount = token.swapCount ?? existing?.swapCount ?? 0

  // Boost signal (most important for meme tokens)
  score += Math.min(30, boosts * 3)

  // Volume signal (real trading activity)
  if (volume24h > 1_000_000) score += 25
  else if (volume24h > 100_000) score += 20
  else if (volume24h > 10_000) score += 10

  // Liquidity signal
  if (liquidity > 500_000) score += 20
  else if (liquidity > 50_000) score += 15
  else if (liquidity > 5_000) score += 10

  // FDV signal (higher FDV = more established)
  if (fdv > 10_000_000) score += 15
  else if (fdv > 1_000_000) score += 10
  else if (fdv > 100_000) score += 5

  // Swap count (organic activity)
  score += Math.min(10, swapCount * 2)

  // Age penalty (>4 hours = past the hype window for meme tokens)
  if (ageHours > 4) score = Math.max(Math.round(score * 0.5), score - 20)
  if (ageHours > 24) score = Math.max(Math.round(score * 0.2), score - 50)

  // Recent discovery bonus
  if (ageHours < 0.5) score += 10

  const risk: ScoredToken['risk'] = score >= 70 ? 'low' : score >= 40 ? 'medium' : score >= 20 ? 'high' : 'extreme'

  const scored: ScoredToken = {
    address: token.address,
    chain: token.chain,
    name: token.name ?? existing?.name ?? 'Unknown',
    symbol: token.symbol ?? existing?.symbol ?? '???',
    priceUsd: token.priceUsd ?? existing?.priceUsd ?? 0,
    fdv: fdv ?? existing?.fdv ?? 0,
    liquidity: liquidity ?? existing?.liquidity ?? 0,
    volume24h: volume24h ?? existing?.volume24h ?? 0,
    boosts: boosts,
    age: Math.round(ageHours * 3600),
    score: Math.min(100, Math.max(0, Math.round(score))),
    risk,
    sources: [...new Set([...(existing?.sources ?? []), ...(token.sources ?? [])])],
    firstSeen,
    swapCount,
  }

  tokenRegistry.set(token.address, { ...scored, firstSeen })
  return scored
}