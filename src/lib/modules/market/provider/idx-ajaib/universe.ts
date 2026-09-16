// ─────────────────────────────────────────────────────────────
// Ajaib IDX Universe Provider — whole-market snapshot scraped via
// Ajaib's own Next.js RSC flight route (server-rendered listing).
// Keyless, no auth. SERVER-ONLY. Consume via /api/v1/saham/ajaib.
//
// Route: GET ajaib.co.id/saham/aset?page=1&page_size=900 with
// iPhone UA + `RSC: 1` header → flight payload embeds
// {"count":882,"next":"…","results":[{code,name,price,
// market_cap,volume,price_1_week,price_1_month}]}.
// Live-verified 2026-09-15 (882 codes, one call).
// TRANSPORT NOTE: Cloudflare on ajaib.co.id blocks Node runtimes
// (undici fetch AND node:https → HTTP 403) on TLS fingerprint,
// while curl with the same UA returns 200. So the LIVE path goes
// through a standalone curl child (no runtime deps changed,
// nothing else in the repo affected).
// ─────────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process'
import { getCached } from '@/lib/api/server-cache'
import { prisma } from '@/lib/db'
const LIST_URL = 'https://ajaib.co.id/saham/aset'
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

const CACHE_TTL = 6 * 60 * 60_000

export interface AjaibMomentum {
  price: number | null
  pctChange: number | null
  priceChange: number | null
}

export interface AjaibUniverseRow {
  code: string
  name: string
  price: number | null
  marketCap: number | null
  volume: number | null
  week: AjaibMomentum | null
  month: AjaibMomentum | null
}

export interface AjaibUniverse {
  count: number
  capturedAt: string
  rows: AjaibUniverseRow[]
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/** Thrown when the DB holds no snapshot yet — never cached, so the
 * route serves 503 and the first post-harvest read is fresh.
 * (Caching an empty result caused a stale-empty incident 2026-09-16.) */
export class EmptySnapshotError extends Error {
  constructor(source: string) {
    super(`No ${source} snapshot in DB yet`)
    this.name = 'EmptySnapshotError'
  }
}

function toMomentum(v: unknown): AjaibMomentum | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  return { price: num(o.price), pctChange: num(o.pct_change), priceChange: num(o.price_change) }
}

function toRow(o: Record<string, unknown>): AjaibUniverseRow | null {
  if (typeof o.code !== 'string' || typeof o.name !== 'string') return null
  return {
    code: o.code,
    name: o.name,
    price: num(o.price),
    marketCap: num(o.market_cap),
    volume: num(o.volume),
    week: toMomentum(o.price_1_week),
    month: toMomentum(o.price_1_month),
  }
}

/** Extract the embedded results[] array from a raw RSC flight body. Throws when absent. */
export function extractUniverseRecords(raw: string): Array<Record<string, unknown>> {
  // Flight payloads escape quotes as \" — normalize before scanning.
  const text = raw.replace(/\\"/g, '"')
  const key = '"results":['
  const at = text.indexOf(key)
  if (at < 0) throw new Error('Ajaib universe: no results[] in RSC payload')
  let depth = 0
  let inStr = false
  let esc = false
  const start = at + key.length - 1 // at '['
  for (let j = start; j < text.length; j++) {
    const c = text[j]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) {
        const parsed: unknown = JSON.parse(text.slice(start, j + 1))
        if (!Array.isArray(parsed)) throw new Error('Ajaib universe: results[] is not an array')
        return parsed as Array<Record<string, unknown>>
      }
    }
  }
  throw new Error('Ajaib universe: unterminated results[] in RSC payload')
}

/** Env copy with every *proxy* var removed (case-insensitive). */
function directEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const k of Object.keys(env)) {
    if (k.toLowerCase().includes('proxy')) delete env[k]
  }
  return env
}

/** Standalone curl GET (direct egress). Returns { status, body }. */
export function rscGet(url: string): { status: number; body: string } {
  const out = execFileSync(
    'curl',
    [
      '-sS',
      '--max-time',
      '25',
      '-H',
      `User-Agent: ${IPHONE_UA}`,
      '-H',
      'Accept: */*',
      '-H',
      'RSC: 1',
      '-H',
      'Accept-Language: id-ID,id;q=0.9',
      '-w',
      '\nCURL_STATUS:%{http_code}',
      url,
    ],
    { env: directEnv(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30_000 },
  ) as string
  const m = /\nCURL_STATUS:(\d{3})\s*$/.exec(out)
  const status = m ? Number(m[1]) : 0
  return { status, body: m ? out.slice(0, m.index) : out }
}

async function fetchUniverse(): Promise<AjaibUniverse> {
  const { status, body: raw } = rscGet(`${LIST_URL}?page=1&page_size=900`)
  if (status !== 200) throw new Error(`Ajaib universe HTTP ${status}`)
  const normalized = raw.replace(/\\"/g, '"')
  const records = extractUniverseRecords(raw)
  const rows: AjaibUniverseRow[] = []
  for (const r of records) {
    const row = toRow(r)
    if (row) rows.push(row)
  }
  const countMatch = /"count":(\d+)/.exec(normalized)
  const declared = countMatch ? Number(countMatch[1]) : rows.length
  return { count: declared, capturedAt: new Date().toISOString(), rows }
}

function dbRowToUniverseRow(r: {
  code: string
  name: string
  price: number | null
  marketCap: number | null
  volume: number | null
  weekPrice: number | null
  weekPct: number | null
  weekChg: number | null
  monthPrice: number | null
  monthPct: number | null
  monthChg: number | null
}): AjaibUniverseRow {
  return {
    code: r.code,
    name: r.name,
    price: r.price,
    marketCap: r.marketCap,
    volume: r.volume,
    week:
      r.weekPrice === null && r.weekPct === null && r.weekChg === null
        ? null
        : { price: r.weekPrice, pctChange: r.weekPct, priceChange: r.weekChg },
    month:
      r.monthPrice === null && r.monthPct === null && r.monthChg === null
        ? null
        : { price: r.monthPrice, pctChange: r.monthPct, priceChange: r.monthChg },
  }
}

/**
 * DB-first: serve the nightly harvest snapshot; live-fetch only when
 * the DB has no snapshot yet (server 6h-cache wraps both paths).
 */
export async function getAjaibUniverse(): Promise<AjaibUniverse & { source: 'db' | 'live' }> {
  const { data } = await getCached('ajaib-universe:v1', CACHE_TTL, async () => {
    const latest = await prisma.idxAjaibUniverse.findFirst({
      orderBy: { snapshotDate: 'desc' },
      select: { snapshotDate: true },
    })
    if (latest) {
      const dbRows = await prisma.idxAjaibUniverse.findMany({
        where: { snapshotDate: latest.snapshotDate },
      })
      if (dbRows.length === 0) throw new EmptySnapshotError('Ajaib universe')
      return {
        count: dbRows.length,
        capturedAt: new Date(`${latest.snapshotDate}T00:00:00Z`).toISOString(),
        rows: dbRows.map(dbRowToUniverseRow),
        source: 'db' as const,
      }
    }
    const live = await fetchUniverse()
    if (live.rows.length === 0) throw new EmptySnapshotError('Ajaib universe')
    return { ...live, source: 'live' as const }
  })
  return data
}
