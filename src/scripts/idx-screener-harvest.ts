#!/usr/bin/env node
// -------------------------------------------------------------
// IDX Screener Harvester — TradingView indonesia scanner.
// 844 saham IDX × fundamentals + performance windows + 52w hi/lo.
//
// History: ihsgscreener.com/data.json went login-walled 2026-09-11
// ("Silakan login terlebih dahulu" HTTP 401). Replaced with the
// keyless TV scanner single-shot [0,20000] — same proven pattern as
// idx-fundamentals-harvest.ts and idx-universe-harvest.ts.
//
// Column contract (index-pinned, verified 2026-09-18):
//   0 description  company name (str, 844/844)
//   1 close        last price
//   2 change       % 1d
//   3 Perf.YTD     % YTD
//   4 Perf.Y       % 52w  (Perf.1Y is null — use Perf.Y)
//   5 Perf.1M      % ~4w
//   6 Perf.3M      % ~13w
//   7 Perf.6M      % ~26w
//   8 sector       TV sector
//   9 industry     TV industry
//   10 volume      shares
//   11 market_cap_basic  IDR
//   12 price_earnings_ttm
//   13 price_book_ratio
//   14 return_on_equity  PERCENT
//   15 return_on_assets  PERCENT
//   16 net_margin   % (net_profit_margin is null — use net_margin)
//   17 debt_to_equity
//   18 earnings_per_share_basic_ttm  IDR
//   19 total_revenue  IDR
//   20 price_52_week_high
//   21 price_52_week_low
// Gaps vs old source: subsector/subindustry not provided by TV —
// stored as ''. No consumer filters on them (sector mapping only).
// Writes: IdxScreenerSnapshot (per code per snapshotDate).
// -------------------------------------------------------------

import 'dotenv/config'
import { z } from 'zod'
import { prisma } from '@/lib/db'

const SCAN_URL = 'https://scanner.tradingview.com/indonesia/scan'
const MAX_ROWS = 20_000

const ScanResponse = z.object({
  totalCount: z.number(),
  data: z.array(z.object({ s: z.string(), d: z.unknown().optional() })),
})

interface ScreenerRow {
  symbol: string
  name: string
  sector: string
  subsector: string
  industry: string
  subindustry: string
  per: number | null
  pbv: number | null
  der: number | null
  roa: number | null
  roe: number | null
  npm: number | null
  eps: number | null
  revenue: number | null
  marketCap: number | null
  price: number | null
  change1d: number | null
  high52w: number | null
  low52w: number | null
  volume: number | null
  change4w: number | null
  change13w: number | null
  change26w: number | null
  change52w: number | null
  ytd: number | null
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

async function main() {
  const res = await fetch(SCAN_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(40_000),
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
    },
    body: JSON.stringify({
      filter: [{ left: 'type', operation: 'equal', right: 'stock' }],
      options: { lang: 'en' },
      columns: [
        'description',
        'close',
        'change',
        'Perf.YTD',
        'Perf.Y',
        'Perf.1M',
        'Perf.3M',
        'Perf.6M',
        'sector',
        'industry',
        'volume',
        'market_cap_basic',
        'price_earnings_ttm',
        'price_book_ratio',
        'return_on_equity',
        'return_on_assets',
        'net_margin',
        'debt_to_equity',
        'earnings_per_share_basic_ttm',
        'total_revenue',
        'price_52_week_high',
        'price_52_week_low',
      ],
      range: [0, MAX_ROWS],
    }),
  })
  if (!res.ok) throw new Error(`indonesia scan HTTP ${res.status}`)
  const parsed = ScanResponse.parse(await res.json())

  const rows: ScreenerRow[] = []
  for (const item of parsed.data) {
    if (!item.s.startsWith('IDX:')) continue
    const d = Array.isArray(item.d) ? (item.d as unknown[]) : []
    const symbol = item.s.slice(4).trim().toUpperCase()
    if (!symbol) continue
    rows.push({
      symbol,
      name: typeof d[0] === 'string' ? d[0] : '',
      sector: typeof d[8] === 'string' ? d[8] : '',
      subsector: '',
      industry: typeof d[9] === 'string' ? d[9] : '',
      subindustry: '',
      per: num(d[12]),
      pbv: num(d[13]),
      der: num(d[17]),
      roa: num(d[15]),
      roe: num(d[14]),
      npm: num(d[16]),
      eps: num(d[18]),
      revenue: num(d[19]),
      marketCap: num(d[11]),
      price: num(d[1]),
      change1d: num(d[2]),
      high52w: num(d[20]),
      low52w: num(d[21]),
      volume: num(d[10]),
      change4w: num(d[5]),
      change13w: num(d[6]),
      change26w: num(d[7]),
      change52w: num(d[4]),
      ytd: num(d[3]),
    })
  }
  if (rows.length === 0) throw new Error('no stocks in scanner response')

  const snapshotDate = new Date().toISOString().slice(0, 10)
  await prisma.$transaction(async (tx) => {
    for (const r of rows) {
      await tx.idxScreenerSnapshot.upsert({
        where: { code_snapshotDate: { code: r.symbol, snapshotDate } },
        create: {
          code: r.symbol,
          snapshotDate,
          name: r.name,
          sector: r.sector,
          subsector: r.subsector,
          industry: r.industry,
          subindustry: r.subindustry,
          per: r.per,
          pbv: r.pbv,
          der: r.der,
          roa: r.roa,
          roe: r.roe,
          npm: r.npm,
          eps: r.eps,
          revenue: r.revenue,
          marketCap: r.marketCap,
          price: r.price,
          change1d: r.change1d,
          high52w: r.high52w,
          low52w: r.low52w,
          volume: r.volume,
          change4w: r.change4w,
          change13w: r.change13w,
          change26w: r.change26w,
          change52w: r.change52w,
          ytd: r.ytd,
        },
        update: {
          name: r.name,
          sector: r.sector,
          subsector: r.subsector,
          industry: r.industry,
          subindustry: r.subindustry,
          per: r.per,
          pbv: r.pbv,
          der: r.der,
          roa: r.roa,
          roe: r.roe,
          npm: r.npm,
          eps: r.eps,
          revenue: r.revenue,
          marketCap: r.marketCap,
          price: r.price,
          change1d: r.change1d,
          high52w: r.high52w,
          low52w: r.low52w,
          volume: r.volume,
          change4w: r.change4w,
          change13w: r.change13w,
          change26w: r.change26w,
          change52w: r.change52w,
          ytd: r.ytd,
        },
      })
    }
  })


  console.log(`[idx-screener] ${rows.length} stocks · snapshotDate ${snapshotDate}`)
  await prisma.$disconnect()
}


main().catch(async (e) => {
  console.error('FAIL:', e.message)
  await prisma.$disconnect()
  process.exit(1)
})
