// ─────────────────────────────────────────────────────────────
// Prediction Markets Aggregator
// Aggregates data from Polymarket, Manifold, and Metaculus
// Zero API keys — all public endpoints
// Normalizes into a unified market format for cross-platform comparison
// ─────────────────────────────────────────────────────────────

import { getCached } from '@/lib/api/server-cache'

// ─── Unified Types ──────────────────────────────────────────

export interface NormalizedMarket {
  id: string
  question: string
  source: 'polymarket' | 'manifold' | 'metaculus' | 'alphio'
  probability: number        // 0–1, YES probability
  volume24h: number          // USD volume last 24h
  totalVolume: number        // lifetime USD volume
  liquidity: number          // current liquidity depth
  category: string           // normalized category
  url: string                // direct link to market
  active: boolean
  endDate: string | null     // ISO resolution date
  traderCount: number
  outcomes: string[]         // e.g. ['Yes', 'No']
  createdAt: string | null
}

export interface AggregatedResult {
  markets: NormalizedMarket[]
  sources: {
    polymarket: { count: number; status: 'ok' | 'error'; latencyMs: number }
    manifold: { count: number; status: 'ok' | 'error'; latencyMs: number }
    metaculus: { count: number; status: 'ok' | 'error'; latencyMs: number }
    alphio: { count: number; status: 'ok' | 'error'; latencyMs: number }
  }
  totalMarkets: number
  timestamp: number
}

// ─── Polymarket (CLOB API) ──────────────────────────────────

interface PolymarketToken {
  outcome?: string
  price?: string | number
}

interface PolymarketMarket {
  condition_id?: string
  question?: string
  question_slug?: string
  market_slug?: string
  closed?: boolean
  volume24hr?: string | number
  volume?: string | number
  liquidity?: string | number
  tokens?: PolymarketToken[]
  end_date_iso?: string
  created_at?: string
  active?: boolean
}

async function fetchPolymarketMarkets(limit: number): Promise<{ markets: NormalizedMarket[]; latencyMs: number }> {
  const start = Date.now()
  const markets: NormalizedMarket[] = []

  try {
    // Use Gamma Markets API for better data
    const res = await fetch(
      `https://gamma-api.polymarket.com/markets?limit=${limit}&active=true&closed=false&order=volume24hr&ascending=false`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) }
    )

    if (res.ok) {
      const data = (await res.json()) as PolymarketMarket[] | { data?: PolymarketMarket[] }
      const raw = Array.isArray(data) ? data : (data?.data ?? [])

      for (const m of raw) {
        const tokens = m.tokens ?? []
        const yesToken = tokens.find((t) => t.outcome?.toLowerCase() === 'yes')
        let probability = 0.5
        if (yesToken?.price != null) {
          const p = typeof yesToken.price === 'string' ? parseFloat(yesToken.price) : yesToken.price
          if (typeof p === 'number' && p >= 0 && p <= 1) probability = p
        }

        const vol24h = toNum(m.volume24hr ?? m.volume ?? 0)
        const totalVol = toNum(m.volume ?? 0)
        const liq = toNum(m.liquidity ?? 0)
        const slug = m.market_slug ?? m.question_slug ?? ''

        markets.push({
          id: `polymarket:${m.condition_id ?? slug}`,
          question: m.question ?? 'Unknown',
          source: 'polymarket',
          probability,
          volume24h: vol24h,
          totalVolume: totalVol,
          liquidity: liq,
          category: categorizeQuestion(m.question ?? ''),
          url: slug ? `https://polymarket.com/event/${slug}` : 'https://polymarket.com',
          active: m.active !== false && m.closed !== true,
          endDate: m.end_date_iso ?? null,
          traderCount: 0,
          outcomes: tokens.map((t) => t.outcome ?? 'Unknown').filter(Boolean),
          createdAt: m.created_at ?? null,
        })
      }
    }
  } catch { /* graceful degradation */ }

  return { markets, latencyMs: Date.now() - start }
}

// ─── Manifold Markets ───────────────────────────────────────

interface ManifoldMarket {
  id: string
  question: string
  slug?: string
  probability?: number
  volume?: number
  volume24Hours?: number
  liquidity?: number
  isResolved?: boolean
  closeTime?: number
  createdTime?: number
  creatorName?: string
  outcomeType?: string
  answers?: Array<{ text?: string; probability?: number }>
  groupSlugs?: string[]
}

async function fetchManifoldMarkets(limit: number): Promise<{ markets: NormalizedMarket[]; latencyMs: number }> {
  const start = Date.now()
  const markets: NormalizedMarket[] = []

  try {
    const res = await fetch(
      `https://manifold.markets/api/v0/markets?limit=${limit}&sort=liquidity`,
      { signal: AbortSignal.timeout(10_000) }
    )

    if (res.ok) {
      const data = (await res.json()) as ManifoldMarket[]

      for (const m of data) {
        if (m.isResolved) continue

        const prob = typeof m.probability === 'number' ? m.probability : 0.5
        const slug = m.slug ?? m.id

        markets.push({
          id: `manifold:${m.id}`,
          question: m.question,
          source: 'manifold',
          probability: prob,
          volume24h: m.volume24Hours ?? 0,
          totalVolume: m.volume ?? 0,
          liquidity: m.liquidity ?? 0,
          category: categorizeQuestion(m.question),
          url: `https://manifold.markets/${m.creatorName ?? 'market'}/${slug}`,
          active: !m.isResolved,
          endDate: m.closeTime ? new Date(m.closeTime).toISOString() : null,
          traderCount: 0,
          outcomes: m.outcomeType === 'MULTIPLE'
            ? (m.answers?.map((a) => a.text ?? 'Unknown') ?? ['Multiple'])
            : ['Yes', 'No'],
          createdAt: m.createdTime ? new Date(m.createdTime).toISOString() : null,
        })
      }
    }
  } catch { /* graceful degradation */ }

  return { markets, latencyMs: Date.now() - start }
}

// ─── Metaculus ──────────────────────────────────────────────

interface MetaculusQuestion {
  id: number
  title: string
  slug?: string
  resolution?: string | null
  possibilities?: { max: number; min: number }
  community_prediction?: number
  number_of_predictions?: number
  activity_score?: number
  created_at?: string
  close_date?: string
  url?: string
  tags?: string[]
}

interface MetaculusResponse {
  results?: MetaculusQuestion[]
}

async function fetchMetaculusMarkets(limit: number): Promise<{ markets: NormalizedMarket[]; latencyMs: number }> {
  const start = Date.now()
  const markets: NormalizedMarket[] = []

  try {
    const res = await fetch(
      `https://www.metaculus.com/api/questions/?limit=${limit}&status=open&order=-activity`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) }
    )

    if (res.ok) {
      const data = (await res.json()) as MetaculusResponse
      const questions = data.results ?? []

      for (const q of questions) {
        if (q.resolution != null) continue

        // Metaculus predictions are 0–1 for binary questions
        let probability = 0.5
        if (typeof q.community_prediction === 'number') {
          // Metaculus values are already in 0–1 range for binary
          probability = Math.max(0, Math.min(1, q.community_prediction))
        }

        const slug = q.slug ?? `question-${q.id}`

        markets.push({
          id: `metaculus:${q.id}`,
          question: q.title,
          source: 'metaculus',
          probability,
          volume24h: 0,
          totalVolume: 0,
          liquidity: 0,
          category: categorizeQuestion(q.title),
          url: q.url ?? `https://www.metaculus.com/questions/${q.id}/${slug}/`,
          active: q.resolution == null,
          endDate: q.close_date ?? null,
          traderCount: q.number_of_predictions ?? 0,
          outcomes: ['Yes', 'No'],
          createdAt: q.created_at ?? null,
        })
      }
    }
  } catch { /* graceful degradation */ }

  return { markets, latencyMs: Date.now() - start }
}

// ─── Alphio (keyless POST) ────────────────────────────────────
// RE 2026-10-09 from app.alphio.ai Vite bundle (App-*.js MEME_PATHS +
// GET_TRENDING_MARKETS constants): api.alphio.ai Bearer-walled with
// {ret:10023,"msg":"user not login"} EXCEPT the prediction read family,
// which returns {ret:0} keyless on plain POST Content-Type: application/json.
// Proven live: trending-markets + events + event-detail + event/quotes +
// event/probability-trend + event/activity. Auth-walled (skipped):
// crypto/meme/*, stock/screener-*, prediction/trade/*, ai-comment.
// NOTE: event rows carry NO top-level volume/liquidity — only quotes rows
// do (best_bid/best_ask). volume24h/liquidity stay 0 (confirmed-absent).

const ALPHIO_BASE = 'https://api.alphio.ai'
const ALPHIO_TIMEOUT_MS = 10_000

interface AlphioQuote {
  outcome?: string
  market_id?: string
  best_bid?: string
  best_ask?: string
  last_price?: string
}

interface AlphioMarket {
  market_id?: string
  event_id?: string
  question?: string
  title?: string
  event_slug?: string
  slug?: string
  current_price?: string
  volume_num?: string
  end_time?: string
  tag?: string
  icon?: string
  options?: Array<{ name?: string; value?: string; token_id?: string }>
  markets?: Array<{
    market_id?: string
    event_id?: string
    question?: string
    icon?: string
    event_slug?: string
    volume_num?: string
    end_time?: string
    options?: Array<{ name?: string; value?: string; token_id?: string }>
  }>
}

interface AlphioListResponse {
  ret?: number
  msg?: string
  data?: { list?: AlphioMarket[]; next_cursor?: string }
}

interface AlphioQuotesResponse {
  ret?: number
  msg?: string
  data?: { list?: AlphioQuote[] }
}

// end_time arrives as epoch SECONDS string ("1791634800"); NormalizedMarket
// endDate is ISO. Returns null on garbage so consumers can skip safely.
function alphioEndIso(v: unknown): string | null {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  const ms = n < 1e12 ? n * 1000 : n
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

async function alphioPost<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${ALPHIO_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ALPHIO_TIMEOUT_MS),
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

async function fetchAlphioMarkets(limit: number): Promise<{ markets: NormalizedMarket[]; latencyMs: number }> {
  const start = Date.now()
  const markets: NormalizedMarket[] = []

  const [trending, events] = await Promise.all([
    alphioPost<AlphioListResponse>('/v1/prediction/trending-markets', { cursor: '', limit }),
    alphioPost<AlphioListResponse>('/v1/prediction/events', { cursor: '', limit }),
  ])

  const seen = new Set<string>()
  for (const row of [...(trending?.data?.list ?? []), ...(events?.data?.list ?? [])]) {
    // events rows nest markets[]; trending rows are flat market rows
    const nested = row.markets?.length ? row.markets : [row]
    for (const m of nested) {
      const slug = m.event_slug ?? (row as AlphioMarket).event_slug ?? (row as AlphioMarket).slug ?? ''
      const eventId = m.event_id ?? row.event_id ?? m.market_id ?? ''
      if (!eventId || seen.has(`alphio:${eventId}`)) continue
      seen.add(`alphio:${eventId}`)
      // options carry outcome percentages as strings ("50.5"); Yes/No-style
      // rows carry no options — quotes (below) supply the probability.
      let opts = m.options ?? []
      const yesOpt = opts.find((o) => (o.name ?? '').toLowerCase() === 'yes')
      const first = opts[0]
      const rawProb = yesOpt?.value ?? first?.value ?? null
      const parsed = rawProb == null ? NaN : Number(rawProb)
      let probability = Number.isFinite(parsed)
        ? Math.max(0, Math.min(1, parsed > 1 ? parsed / 100 : parsed))
        : NaN
      // One quotes call per event (10 rows max, keyless): Yes-midpoint is the
      // real-money probability; midpoint = (bid+ask)/2. Quotes rows also
      // supply outcomes for Yes/No-less rows (Up/Down etc.).
      // quotes REQUIRES the event-level id — sending a market_id returns
      // {ret:0,list:[]} (probed live 2026-10-09).
      try {
        const qEventId = String(m.event_id ?? row.event_id ?? '')
        const q = qEventId
          ? await alphioPost<AlphioQuotesResponse>('/v1/prediction/event/quotes', { event_id: qEventId })
          : null
        const qRows = q?.data?.list ?? []
        const yesQ = qRows.find((x) => (x.outcome ?? '').toLowerCase() === 'yes')
        const bid = Number(yesQ?.best_bid)
        const ask = Number(yesQ?.best_ask)
        if (Number.isFinite(bid) && Number.isFinite(ask)) probability = (bid + ask) / 2
        const qNames = [...new Set(qRows.map((x) => x.outcome ?? '').filter(Boolean))]
        if (qNames.length) opts = qNames.map((name) => ({ name }))
      } catch { /* keep options-derived probability */ }
      if (!Number.isFinite(probability)) probability = 0.5
      const question = m.question ?? row.question ?? row.title ?? 'Unknown'
      markets.push({
        id: `alphio:${eventId}`,
        question,
        source: 'alphio',
        probability,
        volume24h: 0, // event rows expose no top-level volume
        totalVolume: Number((m as AlphioMarket).volume_num ?? (row as AlphioMarket).volume_num ?? 0) || 0,
        liquidity: 0, // quotes carry bid/ask but no depth
        category: categorizeQuestion(question),
        url: slug ? `https://app.alphio.ai/prediction/event/${slug}` : 'https://app.alphio.ai/prediction',
        active: true,
        endDate: alphioEndIso((m as AlphioMarket).end_time ?? (row as AlphioMarket).end_time),
        traderCount: 0,
        outcomes: opts.map((o) => o.name ?? 'Unknown').filter(Boolean),
        createdAt: null,
      })
      if (markets.length >= limit) break
    }
    if (markets.length >= limit) break
  }

  return { markets, latencyMs: Date.now() - start }
}

const CACHE_KEY = 'prediction-markets:aggregated'
const CACHE_TTL = 120_000 // 2 minutes

export async function getAggregatedMarkets(opts: {
  limit?: number
  source?: string
  category?: string
  sort?: string
  order?: string
} = {}): Promise<AggregatedResult> {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50))

  const { data } = await getCached<AggregatedResult>(
    CACHE_KEY,
    CACHE_TTL,
    async () => {
      // Fetch from all sources in parallel
      const [pm, mf, mc, al] = await Promise.allSettled([
        fetchPolymarketMarkets(limit),
        fetchManifoldMarkets(limit),
        fetchMetaculusMarkets(limit),
        fetchAlphioMarkets(limit),
      ])

      const pmResult = pm.status === 'fulfilled' ? pm.value : { markets: [] as NormalizedMarket[], latencyMs: 0 }
      const mfResult = mf.status === 'fulfilled' ? mf.value : { markets: [] as NormalizedMarket[], latencyMs: 0 }
      const mcResult = mc.status === 'fulfilled' ? mc.value : { markets: [] as NormalizedMarket[], latencyMs: 0 }
      const alResult = al.status === 'fulfilled' ? al.value : { markets: [] as NormalizedMarket[], latencyMs: 0 }

      const all = [...pmResult.markets, ...mfResult.markets, ...mcResult.markets, ...alResult.markets]

      return {
        markets: all,
        sources: {
          polymarket: {
            count: pmResult.markets.length,
            status: pm.status === 'fulfilled' ? 'ok' : 'error',
            latencyMs: pmResult.latencyMs,
          },
          manifold: {
            count: mfResult.markets.length,
            status: mf.status === 'fulfilled' ? 'ok' : 'error',
            latencyMs: mfResult.latencyMs,
          },
          metaculus: {
            count: mcResult.markets.length,
            status: mc.status === 'fulfilled' ? 'ok' : 'error',
            latencyMs: mcResult.latencyMs,
          },
          alphio: {
            count: alResult.markets.length,
            status: al.status === 'fulfilled' ? 'ok' : 'error',
            latencyMs: alResult.latencyMs,
          },
        },
        totalMarkets: all.length,
        timestamp: Date.now(),
      }
    }
  )

  return filterAndSort(data, opts)
}

// ─── Cross-Platform Correlations ────────────────────────────

export interface CrossPlatformMarket {
  question: string
  normalizedQuestion: string
  platforms: Array<{
    source: string
    probability: number
    url: string
    volume: number
  }>
  avgProbability: number
  maxSpread: number   // largest probability disagreement
}

export async function getCrossPlatformMarkets(): Promise<CrossPlatformMarket[]> {
  const { data } = await getCached<CrossPlatformMarket[]>(
    'prediction-markets:cross-platform',
    CACHE_TTL,
    async () => {
      const result = await getAggregatedMarkets({ limit: 100 })
      return findCrossPlatformMarkets(result.markets)
    }
  )
  return data
}

function findCrossPlatformMarkets(markets: NormalizedMarket[]): CrossPlatformMarket[] {
  // Group by normalized question similarity
  const groups = new Map<string, NormalizedMarket[]>()

  for (const m of markets) {
    const norm = normalizeQuestion(m.question)
    const key = findGroupKey(norm, groups)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(m)
  }

  // Only return groups with 2+ platforms
  const result: CrossPlatformMarket[] = []

  for (const [, group] of Array.from(groups)) {
    const sources = new Set(group.map((m) => m.source))
    if (sources.size < 2) continue

    const probs = group.map((m) => m.probability)
    const avgProb = probs.reduce((a, b) => a + b, 0) / probs.length
    const maxSpread = Math.max(...probs) - Math.min(...probs)

    result.push({
      question: group[0].question,
      normalizedQuestion: normalizeQuestion(group[0].question),
      platforms: group.map((m) => ({
        source: m.source,
        probability: m.probability,
        url: m.url,
        volume: m.totalVolume,
      })),
      avgProbability: avgProb,
      maxSpread,
    })
  }

  return result.sort((a, b) => b.maxSpread - a.maxSpread)
}

// ─── Utilities ──────────────────────────────────────────────

function toNum(v: string | number): number {
  if (typeof v === 'number') return v
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

function normalizeQuestion(q: string): string {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function findGroupKey(normalized: string, groups: Map<string, NormalizedMarket[]>): string {
  // Simple Jaccard on word tokens for fuzzy matching
  const words = new Set(normalized.split(' '))
  for (const key of Array.from(groups.keys())) {
    const keyWords = new Set(Array.from(key.split(' ')))
    const intersection = new Set(Array.from(words).filter((w) => keyWords.has(w)))
    const union = new Set(Array.from(words).concat(Array.from(keyWords)))
    const jaccard = union.size > 0 ? intersection.size / union.size : 0
    if (jaccard > 0.6) return key
  }
  return normalized
}

function categorizeQuestion(q: string): string {
  const lower = q.toLowerCase()
  if (/bitcoin|btc|crypto|ethereum|eth|solana|sol|token|defi|nft|blockchain/i.test(lower)) return 'crypto'
  if (/election|president|vote|political|congress|senate|governor|party/i.test(lower)) return 'politics'
  if (/fed|interest rate|inflation|gdp|unemployment|recession|economy|tariff|trade war/i.test(lower)) return 'economics'
  if (/ai|artificial intelligence|gpt|openai|google|apple|microsoft|tech|nvidia/i.test(lower)) return 'technology'
  if (/war|conflict|military|nato|russia|ukraine|china|taiwan|sanctions/i.test(lower)) return 'geopolitics'
  if (/sports?|nba|nfl|soccer|football|tennis|championship|world cup|olympic/i.test(lower)) return 'sports'
  if (/weather|earthquake|hurricane|flood|climate|temperature/i.test(lower)) return 'weather'
  if (/movie|oscar|grammy|emmy|celebrity|music|album|box office/i.test(lower)) return 'entertainment'
  if (/science|space|nasa|vaccine|drug|fda|health|pandemic|covid/i.test(lower)) return 'science'
  return 'general'
}

function filterAndSort(data: AggregatedResult, opts: {
  source?: string
  category?: string
  sort?: string
  order?: string
}): AggregatedResult {
  let markets = data.markets

  // Filter by source
  if (opts.source && opts.source !== 'all') {
    const sources = opts.source.split(',').map((s) => s.trim())
    markets = markets.filter((m) => sources.includes(m.source))
  }

  // Filter by category
  if (opts.category && opts.category !== 'all') {
    markets = markets.filter((m) => m.category === opts.category)
  }

  // Sort
  const sortField = opts.sort ?? 'volume24h'
  const order = opts.order === 'asc' ? 1 : -1

  const sortFns: Record<string, (a: NormalizedMarket, b: NormalizedMarket) => number> = {
    volume24h: (a, b) => (a.volume24h - b.volume24h) * order,
    totalVolume: (a, b) => (a.totalVolume - b.totalVolume) * order,
    liquidity: (a, b) => (a.liquidity - b.liquidity) * order,
    probability: (a, b) => (a.probability - b.probability) * order,
    traderCount: (a, b) => (a.traderCount - b.traderCount) * order,
  }

  const sortFn = sortFns[sortField] ?? sortFns.volume24h
  markets = [...markets].sort(sortFn)

  return { ...data, markets, totalMarkets: markets.length }
}
