// ─────────────────────────────────────────────────────────────
// IDX Fundamentals Harvester — nightly PER/PBV/ROE/DER/EPS/
// marketCap/dividendYield for the whole universe.
//
// Source: TradingView indonesia scanner fundamental COLUMNS —
// ONE keyless request returns all ~844 stocks exactly once
// (same proven single-shot pattern as global-universe).
// Replaces the old per-symbol Yahoo quoteSummary batch, which
// this server's IP could never complete (persistent 429s,
// best coverage 0/844).
//
// Units contract (documented, consumed by /api/v1/saham/fundamentals):
//   per/pbv        multiples      e.g. INDF 6.72 / 0.88
//   roe            PERCENT        e.g. INDF 13.24
//   der            RATIO          e.g. 0.546
//   eps            IDR (TTM)      e.g. INDF 1089.99
//   marketCap      IDR
//   dividendYield  PERCENT (TTM/current)
//
// Cron (unchanged):
//   20 18 * * 1-5 cd /home/openclaw/projects/1ai-tracker && npm run harvest:idx-fundamentals >> /tmp/idx-fundamentals.log 2>&1
// Output: data/idx/fundamentals.json { capturedAt, done:[codes], data:{CODE:{...}} }
// ─────────────────────────────────────────────────────────────

import { mkdirSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import { notifyAlert } from '@/lib/config/alerting'

const OUT = join(process.cwd(), 'data', 'idx', 'fundamentals.json')
const SCAN_URL = 'https://scanner.tradingview.com/indonesia/scan'
const MAX_ROWS = 20_000

interface FundRow {
  per?: number | null
  pbv?: number | null
  roe?: number | null
  der?: number | null
  eps?: number | null
  marketCap?: number | null
  dividendYield?: number | null
}

type Store = { capturedAt: string; done: string[]; data: Record<string, FundRow> }

const ScanResponse = z.object({
  totalCount: z.number(),
  data: z.array(z.object({ s: z.string(), d: z.unknown().optional() })),
})

function save(store: Store): void {
  mkdirSync(join(process.cwd(), 'data', 'idx'), { recursive: true })
  const tmp = `${OUT}.tmp`
  writeFileSync(tmp, JSON.stringify(store))
  renameSync(tmp, OUT)
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

async function fetchAllFundamentals(): Promise<Array<{ code: string; row: FundRow }>> {
  const body = JSON.stringify({
    filter: [{ left: 'type', operation: 'equal', right: 'stock' }],
    options: { lang: 'en' },
    columns: [
      'name',
      'market_cap_basic',
      'price_earnings_ttm',
      'price_book_ratio',
      'return_on_equity',
      'debt_to_equity',
      'earnings_per_share_basic_ttm',
      'dividends_yield_current',
      'dividend_yield_recent',
    ],
    range: [0, MAX_ROWS],
  })
  const res = await fetch(SCAN_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(40_000),
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
    },
    body,
  })
  if (!res.ok) throw new Error(`indonesia scan HTTP ${res.status}`)
  const parsed = ScanResponse.parse(await res.json())

  const out: Array<{ code: string; row: FundRow }> = []
  for (const item of parsed.data) {
    if (!item.s.startsWith('IDX:')) continue
    const d = Array.isArray(item.d) ? (item.d as unknown[]) : []
    const code = String(d[0] ?? item.s.slice(4)).trim()
    if (!code) continue
    const dyCurrent = num(d[7])
    const dyRecent = num(d[8])
    out.push({
      code,
      row: {
        marketCap: num(d[1]),
        per: num(d[2]),
        pbv: num(d[3]),
        roe: num(d[4]),
        der: num(d[5]),
        eps: num(d[6]),
        dividendYield: dyCurrent ?? dyRecent,
      },
    })
  }
  return out
}

async function main() {
  try {
    const rows = await fetchAllFundamentals()
    const data: Record<string, FundRow> = {}
    for (const { code, row } of rows) data[code] = row
    const store: Store = { capturedAt: new Date().toISOString(), done: Object.keys(data), data }
    save(store)
    console.log(`[idx-fund] coverage ${store.done.length} stocks · saved ${OUT}`)
  } catch (err) {
    console.error('[idx-fund] harvest failed:', err instanceof Error ? err.message : err)
    await notifyAlert(
      'IDX fundamentals harvest failed',
      err instanceof Error ? err.message : String(err),
    )
    process.exitCode = 1
  }
}

main()
