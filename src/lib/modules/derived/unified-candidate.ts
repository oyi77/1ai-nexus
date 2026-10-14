// ─────────────────────────────────────────────────────────────
// Unified candidate — one identity key + evidence merge across every
// discovery source (Phase 2 of the operator's pipeline spec).
//
// Rules encoded here, not in each discoverer:
//   - Identity is chain-aware. Solana base58 mints are CASE-SENSITIVE:
//     two mints differing only in case are DIFFERENT tokens. EVM
//     addresses are hex checksums → case-insensitive. A blanket
//     toLowerCase() (what discoverCombined used to do) merges two
//     distinct Solana mints into one candidate.
//   - One token found by 3 sources is ONE candidate carrying 3 evidence
//     rows. Evidence is never thrown away, never duplicated.
//   - Category is derived from evidence; MULTI_SOURCE only when more
//     than one provider reported the token.
// Pure — zero I/O, no adapter imports.
// ─────────────────────────────────────────────────────────────

export type DiscoveryCategory =
  | 'NEW_PAIRS'
  | 'BONDING'
  | 'POST_MIGRATED'
  | 'INFLUENCER'
  | 'WHALE_ACTIVITY'
  | 'SMART_MONEY'
  | 'TRENDING'
  | 'MULTI_SOURCE'

export interface CandidateEvidence {
  provider: string
  category: DiscoveryCategory
  discoveredAt: number
  /** Free-text source note (endpoint, channel list, call kinds). */
  note?: string
  /** Confluence / mention counts when the source measured them. */
  confluence?: number
  mentions?: number
  /** Source-defined kinds: trend, whale, kol, shill, score, tool… */
  /** Call-feed weighted confluence (scripts/call-feed.py): sum of per-caller
   * weights. Optional — absent means the artifact predates the field or the
   * source never measured it; never a fabricated 0. */
  weightedScore?: number
  /** Per-caller weights behind weightedScore (channel name → weight). */
  callerWeights?: Record<string, number>
  kinds?: string[]
}

/**
 * Canonical dedup key for (chain, contract).
 *
 * Solana → exact mint (case-sensitive). EVM family → lowercase. Anything
 * else → exact. This is the only identity function the sniper pipeline
 * uses for dedup; callers MUST NOT lowercase a Solana mint.
 */
export function candidateKey(chain: string, contract: string): string {
  const c = (chain || '').toLowerCase()
  const evmLike = c === 'ethereum' || c === 'bsc' || c === 'base' || c === 'arbitrum' || c === 'polygon' || c === 'avalanche' || c === 'optimism'
  if (evmLike || contract.startsWith('0x')) return `${c}:${contract.toLowerCase()}`
  return `${c}:${contract}`
}

/**
 * Category for a single evidence row, derived from the source's own
 * classification (never invented from price/age).
 */
export function categoryFor(
  provider: string,
  opts: { kinds?: string[]; sourceType?: string; note?: string } = {},
): DiscoveryCategory {
  const kinds = (opts.kinds ?? []).map((k) => k.toLowerCase())
  const note = (opts.note ?? '').toLowerCase()
  if (kinds.includes('kol')) return 'INFLUENCER'
  if (kinds.includes('whale')) return 'WHALE_ACTIVITY'
  if (kinds.includes('smart-money')) return 'SMART_MONEY'
  if (provider === 'wallet-trace') return 'WHALE_ACTIVITY'
  if (note.includes('graduated') || note.includes('post-migrated')) return 'POST_MIGRATED'
  if (note.includes('bonding') || note.includes('near_graduation')) return 'BONDING'
  if (provider === 'call-feed') return 'TRENDING'
  return 'NEW_PAIRS'
}

/** Merge evidence arrays without duplicating an identical row. */
export function mergeEvidence(
  a: CandidateEvidence[] | undefined,
  b: CandidateEvidence[] | undefined,
): CandidateEvidence[] {
  const out = [...(a ?? [])]
  for (const row of b ?? []) {
    const dup = out.some(
      (x) => x.provider === row.provider && x.discoveredAt === row.discoveredAt && x.category === row.category,
    )
    if (!dup) out.push(row)
  }
  // Newest first — the operator reads the head of the digest first.
  return out.sort((x, y) => y.discoveredAt - x.discoveredAt)
}

/**
 * Single category for display. MULTI_SOURCE when two or more distinct
 * providers saw the token; the underlying categories stay in evidence.
 */
export function resolveCategory(evidence: CandidateEvidence[] | undefined): DiscoveryCategory {
  const rows = evidence ?? []
  if (rows.length === 0) return 'TRENDING'
  const providers = new Set(rows.map((r) => r.provider))
  if (providers.size > 1) return 'MULTI_SOURCE'
  return rows[0].category
}

export interface MergeableCandidate {
  contract: string
  chain: string
  discoveryEvidence?: CandidateEvidence[]
  [k: string]: unknown
}

/**
 * Merge two rows of the SAME token (same candidateKey): union the
 * evidence, keep the first row's market snapshot but prefer any numeric
 * field the second row measured (later source wins — it is fresher).
 * Pure. Callers must only merge rows already matched by candidateKey.
 */
export function mergeCandidates<T extends MergeableCandidate>(a: T, b: T): T {
  const merged: T = { ...b, ...a }
  for (const key of ['marketCap', 'volume24h', 'liquidity', 'price', 'volume5m'] as const) {
    const av = a[key] as number | null | undefined
    const bv = b[key] as number | null | undefined
    if ((av === null || av === undefined || av === 0) && typeof bv === 'number' && bv > 0) {
      ;(merged as Record<string, unknown>)[key] = bv
    }
  }
  merged.discoveryEvidence = mergeEvidence(a.discoveryEvidence, b.discoveryEvidence)
  merged.chain = a.chain
  merged.contract = a.contract
  return merged
}
