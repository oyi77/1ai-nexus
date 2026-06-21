// ─────────────────────────────────────────────────────────────
// Local-Only News Scorer
// Measures how "locally exclusive" a news item is — high score
// means the story hasn't crossed borders (zero cross-border pickup).
// Useful for detecting regional catalysts before global awareness.
// ─────────────────────────────────────────────────────────────

// ─── Types ─────────────────────────────────────────────────

interface NewsEntity {
  name: string
  country?: string
  type?: string
}

export interface ScorableNewsItem {
  source: string
  country: string
  language?: string
  headline: string
  summary?: string
  publishedAt: Date | string
  url: string
  sentimentScore?: number | null
  entities?: NewsEntity[] | null
}

export interface LocalScoreResult {
  /** 0–100, higher = more locally exclusive */
  localOnlyScore: number
  /** Whether source country differs from all entity countries */
  isCrossBorder: boolean
  /** Minutes since publish (lower = fresher local news) */
  minutesSincePublish: number
  /** Reason codes explaining the score */
  reasons: string[]
}

// ─── Constants ─────────────────────────────────────────────

/** Minutes after which a local story is no longer considered "breaking" */
const FRESHNESS_WINDOW_MIN = 120

/** Country codes with strong local news ecosystems */
const LOCAL_ECOSYSTEM_COUNTRIES: Record<string, true> = {
  ID: true, KR: true, JP: true, IN: true, BR: true,
  TR: true, NG: true, TH: true, VN: true, PH: true,
}

// ─── Scoring ───────────────────────────────────────────────

/**
 * Calculate a localOnlyScore (0–100) for a news item.
 *
 * Components:
 *   - Freshness (40 pts): fresher → higher, linear decay over FRESHNESS_WINDOW
 *   - Source exclusivity (30 pts): source country is a local ecosystem country
 *   - No cross-border pickup (30 pts): no entities from different countries
 */
export function calculateLocalScore(item: ScorableNewsItem): LocalScoreResult {
  const reasons: string[] = []
  const now = new Date()
  const published = new Date(item.publishedAt)
  const minutesSincePublish = Math.max(0, (now.getTime() - published.getTime()) / 60_000)

  // ── Freshness component (0–40) ─────────────────────────
  const freshnessRatio = Math.max(0, 1 - minutesSincePublish / FRESHNESS_WINDOW_MIN)
  const freshnessScore = Math.round(freshnessRatio * 40)
  if (freshnessScore > 20) reasons.push('fresh')
  if (minutesSincePublish > FRESHNESS_WINDOW_MIN) reasons.push('stale')

  // ── Source exclusivity (0–30) ──────────────────────────
  const isLocalEcosystem = item.country.toUpperCase() in LOCAL_ECOSYSTEM_COUNTRIES
  const sourceScore = isLocalEcosystem ? 30 : 15
  if (isLocalEcosystem) reasons.push('local-ecosystem')

  // ── Cross-border pickup check (0–30) ──────────────────
  const entities: NewsEntity[] = Array.isArray(item.entities) ? item.entities : []
  const sourceCountry = item.country.toUpperCase()

  const foreignEntities = entities.filter(
    (e) => e.country && e.country.toUpperCase() !== sourceCountry,
  )
  const isCrossBorder = foreignEntities.length > 0
  const pickupScore = isCrossBorder ? 0 : 30
  if (!isCrossBorder) reasons.push('no-cross-border-pickup')
  if (isCrossBorder) reasons.push(`cross-border: ${foreignEntities.map((e) => e.country).join(',')}`)

  const localOnlyScore = freshnessScore + sourceScore + pickupScore

  return {
    localOnlyScore: Math.min(100, Math.max(0, localOnlyScore)),
    isCrossBorder,
    minutesSincePublish: Math.round(minutesSincePublish),
    reasons,
  }
}

/**
 * Convenience: returns true if the item is a local exclusive
 * (score ≥ 70, meaning fresh + local ecosystem + no cross-border pickup).
 */
export function isLocalExclusive(item: ScorableNewsItem): boolean {
  return calculateLocalScore(item).localOnlyScore >= 70
}
