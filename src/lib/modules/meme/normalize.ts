// ─────────────────────────────────────────────────────────────
// Meme-Alpha — shared cross-platform normalizers
//
// Measured defects (live 2026-10-07):
//   - chain labels differ per platform: bitget emits `SOL`/`BSC`/`ETH`/
//     `BASE`, gmgn feed uses `sol`/`eth`/`bsc`, fomo uses `eth`, moby
//     uses `bnb`, everyone else uses `solana`/`ethereum`/etc.
//     Unnormalized labels understate cross-platform overlap.
//   - createdAt units differ: bitget `issue_date` arrives in seconds on
//     some rows and ms on others; dexscreener `pairCreatedAt` and birdeye
//     `createdAt` units vary. Values < 1e12 are seconds, else ms.
//   - volume scale anomaly (measured, NOT rescaled): bitget volume_24h
//     ~1e10 against market_cap ~1.2e6 on the same row. Upstream scale is
//     suspect but unconfirmed — values are passed through raw. Do NOT
//     invent rescaling here; revisit only with fresh live evidence.
// ─────────────────────────────────────────────────────────────

/**
 * Canonical chain label. Lowercases, then maps only short labels / ids
 * actually observed in meme adapters (grep 2026-10-07):
 *   SOL/sol->solana, ETH/eth->ethereum, BSC/bsc/BNB/bnb/56->binance-smart-chain,
 *   BASE/base (kept), 1->ethereum, 8453->base, 501->solana, blastr->blast.
 * Unknown labels pass through lowercased (solana/base/arbitrum/robinhood/...).
 */
export function normalizeChainId(raw: unknown): string {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s) return ''
  switch (s) {
    case '1':
      return 'ethereum'
    case '56':
      return 'binance-smart-chain'
    case '8453':
      return 'base'
    case '501':
      return 'solana'
    case 'sol':
      return 'solana'
    case 'eth':
      return 'ethereum'
    case 'bsc':
    case 'bnb':
      return 'binance-smart-chain'
    case 'blastr':
      return 'blast'
    default:
      return s
  }
}

/**
 * Seconds-or-ms epoch normalizer. Accepts numbers, numeric strings, and
 * ISO date strings. Values < 1e12 are treated as seconds, else ms.
 * Returns null for missing/unparseable/non-positive values and for absurd
 * futures (> now + 1y). `now` is injectable for deterministic tests.
 */
export function normalizeTimestamp(v: unknown, now: number = Date.now()): number | null {
  if (v === null || v === undefined || v === '') return null
  let ms: number
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v <= 0) return null
    ms = v < 1e12 ? v * 1000 : v
  } else if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return null
    if (/^-?\d+(\.\d+)?$/.test(s)) {
      const n = Number(s)
      if (!Number.isFinite(n) || n <= 0) return null
      ms = n < 1e12 ? n * 1000 : n
    } else {
      const t = Date.parse(s)
      if (!Number.isFinite(t)) return null
      ms = t
    }
  } else {
    return null
  }
  if (!Number.isFinite(ms)) return null
  if (ms > now + 365 * 24 * 60 * 60 * 1000) return null
  return Math.floor(ms)
}
