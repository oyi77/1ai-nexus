// ─────────────────────────────────────────────────────────────
// SEC EDGAR — Company search, facts, and filings
// Tier 0: free, no API key required
// §2.1 — TradFi backbone: public company fundamentals
// ─────────────────────────────────────────────────────────────

const SEARCH_URL = 'https://efts.sec.gov/LATEST/search-index'
const FACTS_URL = 'https://data.sec.gov/api/xbrl/companyfacts'
const FILINGS_URL = 'https://data.sec.gov/submissions'
const CACHE_TTL = 60 * 60 * 1000 // 1 hour
const RATE_LIMIT_WINDOW = 1000 // 1 second
const RATE_LIMIT_MAX = 10 // 10 req/s per SEC rules

const USER_AGENT = '1ai-tracker (contact@aitradepulse.com)'

// ─── Rate limiter ──────────────────────────────────────────

let requestTimestamps: number[] = []

function trimWindow(): void {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW
  requestTimestamps = requestTimestamps.filter(t => t > cutoff)
}

async function rateLimitedFetch(url: string): Promise<Response> {
  trimWindow()
  if (requestTimestamps.length >= RATE_LIMIT_MAX) {
    const oldest = requestTimestamps[0]
    const waitMs = RATE_LIMIT_WINDOW - (Date.now() - oldest) + 10
    if (waitMs > 0) {
      const { promise, resolve } = Promise.withResolvers<void>()
      setTimeout(resolve, waitMs)
      await promise
    }
    trimWindow()
  }
  requestTimestamps.push(Date.now())

  return fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  })
}

// ─── Cache ─────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T
  timestamp: number
}

const searchCache = new Map<string, CacheEntry<SecCompany[]>>()
const factsCache = new Map<string, CacheEntry<CompanyFacts>>()
const filingsCache = new Map<string, CacheEntry<RecentFiling[]>>()

function getCached<T>(map: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = map.get(key)
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) return entry.data
  if (entry) map.delete(key)
  return null
}

function setCache<T>(map: Map<string, CacheEntry<T>>, key: string, data: T): void {
  map.set(key, { data, timestamp: Date.now() })
}

// ─── Types ─────────────────────────────────────────────────

export interface SecCompany {
  cik: string
  name: string
  ticker: string
  exchange: string
}

interface EftsHit {
  entity_name?: string
  ciks?: string[]
  tickers?: string[]
  exchanges?: string[]
}

interface EftsResponse {
  hits?: {
    hits?: Array<{ _source?: EftsHit }>
  }
}

export interface CompanyFacts {
  cik: string
  entityName: string
  facts: Record<string, Record<string, FactEntry[]>>
}

interface FactEntry {
  end: string
  val: number
  form: string
  filed: string
  fy?: number
  fp?: string
}

interface CompanyFactsRaw {
  cik: string
  entityName: string
  facts: Record<string, Record<string, FactEntry[]>>
}

export interface RecentFiling {
  accessionNumber: string
  filingDate: string
  reportDate: string
  form: string
  primaryDocument: string
  description: string
}

interface SubmissionsResponse {
  cik: string
  name: string
  filings?: {
    recent?: {
      accessionNumber: string[]
      filingDate: string[]
      reportDate: string[]
      form: string[]
      primaryDocument: string[]
      primaryDocDescription: string[]
    }
  }
}

// ─── Public API ────────────────────────────────────────────

/**
 * Search for companies by name or ticker on SEC EDGAR.
 */
export async function searchCompany(query: string): Promise<SecCompany[]> {
  const key = query.toLowerCase().trim()
  const cached = getCached(searchCache, key)
  if (cached) return cached

  const url = `${SEARCH_URL}?q=${encodeURIComponent(key)}`
  const res = await rateLimitedFetch(url)
  if (!res.ok) throw new Error(`SEC search failed: ${res.status}`)

  const body = (await res.json()) as EftsResponse
  const hits = body.hits?.hits ?? []
  const results: SecCompany[] = hits.map(h => {
    const src = h._source ?? {}
    return {
      cik: src.ciks?.[0] ?? '',
      name: src.entity_name ?? '',
      ticker: src.tickers?.[0] ?? '',
      exchange: src.exchanges?.[0] ?? '',
    }
  })

  setCache(searchCache, key, results)
  return results
}

/**
 * Get XBRL company facts (financial data) for a given CIK.
 * @param cik — 10-digit CIK number (e.g. "0000320193" for Apple)
 */
export async function getCompanyFacts(cik: string): Promise<CompanyFacts> {
  const normalizedCik = cik.replace(/^0+/, '').padStart(10, '0')
  const cached = getCached(factsCache, normalizedCik)
  if (cached) return cached

  const url = `${FACTS_URL}/CIK${normalizedCik}.json`
  const res = await rateLimitedFetch(url)
  if (!res.ok) throw new Error(`SEC facts failed for CIK ${cik}: ${res.status}`)

  const body = (await res.json()) as CompanyFactsRaw
  const result: CompanyFacts = {
    cik: body.cik,
    entityName: body.entityName,
    facts: body.facts,
  }

  setCache(factsCache, normalizedCik, result)
  return result
}

/**
 * Get recent SEC filings for a given CIK.
 * @param cik — 10-digit CIK number
 */
export async function getRecentFilings(cik: string): Promise<RecentFiling[]> {
  const normalizedCik = cik.replace(/^0+/, '').padStart(10, '0')
  const cached = getCached(filingsCache, normalizedCik)
  if (cached) return cached

  const url = `${FILINGS_URL}/CIK${normalizedCik}.json`
  const res = await rateLimitedFetch(url)
  if (!res.ok) throw new Error(`SEC filings failed for CIK ${cik}: ${res.status}`)

  const body = (await res.json()) as SubmissionsResponse
  const recent = body.filings?.recent
  if (!recent) {
    setCache(filingsCache, normalizedCik, [])
    return []
  }

  const count = Math.min(recent.accessionNumber.length, 20)
  const filings: RecentFiling[] = []
  for (let i = 0; i < count; i++) {
    filings.push({
      accessionNumber: recent.accessionNumber[i] ?? '',
      filingDate: recent.filingDate[i] ?? '',
      reportDate: recent.reportDate[i] ?? '',
      form: recent.form[i] ?? '',
      primaryDocument: recent.primaryDocument[i] ?? '',
      description: recent.primaryDocDescription[i] ?? '',
    })
  }

  setCache(filingsCache, normalizedCik, filings)
  return filings
}
