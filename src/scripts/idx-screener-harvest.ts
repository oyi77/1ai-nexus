#!/usr/bin/env node
// -------------------------------------------------------------
// IDX Screener Harvester - ihsgscreener.com/data.json
// 958 saham IDX × 25 field (PER, PBV, DER, ROA, ROE, NPM, EPS,
// revenue, marketCap, harga, chg1d, hi52w, lo52w, vol, chg4w/13w/26w/52w, ytd)
// Source: public data.json endpoint (no auth required).
// Response shape: { data: { stocks: [{ kode, nama, sektor, ... }] } }
// Writes: IdxScreenerSnapshot (per code per snapshotDate).
// -------------------------------------------------------------

import 'dotenv/config'
import { prisma } from '@/lib/db'

const SRC = 'https://ihsgscreener.com/data.json'

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
  const res = await fetch(SRC, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' } })
  if (!res.ok) throw new Error(`screener HTTP ${res.status}`)
  const json = (await res.json()) as { stocks?: Array<Record<string, unknown>> }
  const raw = json.stocks ?? []
  if (raw.length === 0) throw new Error('no stocks in screener response')

  const rows: ScreenerRow[] = []
  for (const d of raw) {
    const symbol = String(d.kode ?? d.code ?? d.symbol ?? d.ticker ?? '').trim().toUpperCase().replace(/\.JK$/, '')
    if (!symbol) continue
    rows.push({
      symbol,
      name: String(d.nama ?? d.name ?? d.companyName ?? ''),
      sector: String(d.sektor ?? d.sector ?? ''),
      subsector: String(d.subsektor ?? d.subsector ?? ''),
      industry: String(d.industri ?? d.industry ?? ''),
      subindustry: String(d.subindustri ?? d.subindustry ?? ''),
      per: num(d.per ?? d.PER ?? d.pe),
      pbv: num(d.pbv ?? d.PBV ?? d.pb),
      der: num(d.der ?? d.DER),
      roa: num(d.roa ?? d.ROA),
      roe: num(d.roe ?? d.ROE),
      npm: num(d.npm ?? d.NPM),
      eps: num(d.eps ?? d.EPS),
      revenue: num(d.rev ?? d.revenue ?? d.Revenue ?? d.sales),
      marketCap: num(d.mktcap ?? d.marketCap ?? d.market_cap ?? d.MarketCap),
      price: num(d.harga ?? d.price ?? d.close ?? d.last),
      change1d: num(d.chg1d ?? d.change1d ?? d.change ?? d['1d']),
      high52w: num(d.hi52w ?? d.high52w ?? d.high52 ?? d['52wh']),
      low52w: num(d.lo52w ?? d.low52w ?? d.low52 ?? d['52wl']),
      volume: num(d.vol ?? d.volume ?? d.Volume),
      change4w: num(d.chg4w ?? d.change4w ?? d['4w']),
      change13w: num(d.chg13w ?? d.change13w ?? d['13w']),
      change26w: num(d.chg26w ?? d.change26w ?? d['26w']),
      change52w: num(d.chg52w ?? d.change52w ?? d['52w']),
      ytd: num(d.ytd ?? d.YTD),
    })
  }

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
