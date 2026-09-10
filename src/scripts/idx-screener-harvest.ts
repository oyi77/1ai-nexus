#!/usr/bin/env node
// -------------------------------------------------------------
// IDX Screener Harvester - ihsgscreener.com/data.json
// 958 saham IDX × 25 field (PER, PBV, DER, ROA, ROE, NPM, EPS,
// revenue, marketCap, harga, chg1d, hi52w, lo52w, vol, chg4w/13w/26w/52w, ytd)
// Source: public data.json endpoint (no auth required).
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

function normalize(code: string): string {
  return code.trim().toUpperCase().replace(/\.JK$/, '')
}

async function main() {
  const res = await fetch(SRC, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' } })
  if (!res.ok) throw new Error(`screener HTTP ${res.status}`)
  const json = (await res.json()) as Record<string, unknown>
  const raw = (json.data ?? json) as Array<Record<string, unknown>>

  const rows: ScreenerRow[] = []
  for (const d of raw) {
    const symbol = normalize(String(d.symbol ?? d.ticker ?? d.code ?? ''))
    if (!symbol) continue
    rows.push({
      symbol,
      name: String(d.name ?? d.companyName ?? ''),
      sector: String(d.sector ?? ''),
      subsector: String(d.subsector ?? ''),
      industry: String(d.industry ?? ''),
      subindustry: String(d.subindustry ?? ''),
      per: num(d.per ?? d.PER ?? d.pe),
      pbv: num(d.pbv ?? d.PBV ?? d.pb),
      der: num(d.der ?? d.DER),
      roa: num(d.roa ?? d.ROA),
      roe: num(d.roe ?? d.ROE),
      npm: num(d.npm ?? d.NPM),
      eps: num(d.eps ?? d.EPS),
      revenue: num(d.revenue ?? d.Revenue ?? d.sales),
      marketCap: num(d.marketCap ?? d.market_cap ?? d.MarketCap),
      price: num(d.price ?? d.close ?? d.last),
      change1d: num(d.change1d ?? d.change ?? d['1d']),
      high52w: num(d.high52w ?? d.high52 ?? d['52wh']),
      low52w: num(d.low52w ?? d.low52 ?? d['52wl']),
      volume: num(d.volume ?? d.vol ?? d.Volume),
      change4w: num(d.change4w ?? d['4w']),
      change13w: num(d.change13w ?? d['13w']),
      change26w: num(d.change26w ?? d['26w']),
      change52w: num(d.change52w ?? d['52w']),
      ytd: num(d.ytd ?? d.YTD),
    })
  }

  const snapshotDate = new Date().toISOString().slice(0, 10)

  await prisma.$transaction(async (tx) => {
    for (const r of rows) {
      await tx.idxScreenerSnapshot.upsert({
        where: { code_snapshotDate: { code: r.symbol, snapshotDate } },
        create: { ...r, code: r.symbol, snapshotDate },
        update: { ...r, code: r.symbol, snapshotDate },
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
