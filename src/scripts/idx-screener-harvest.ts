#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// IDX Screener Harvester — ihsgscreener.com/data.json
// 958 saham IDX × 25 field (PER, PBV, DER, ROA, ROE, NPM, EPS,
// revenue, marketCap, harga, chg1d, hi52w, lo52w, vol, chg4w/13w/26w/52w, ytd)
// Source: public data.json endpoint (no auth required).
// ─────────────────────────────────────────────────────────────

import { mkdirSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'

const SRC = 'https://ihsgscreener.com/data.json'
const OUT = join(process.cwd(), 'data', 'idx', 'screener.json')
const TMP = OUT + '.tmp'

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

interface Store {
  capturedAt: string
  source: string
  total: number
  count: number
  data: Record<string, ScreenerRow>
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function normalize(code: string): string {
  return code.trim().toUpperCase().replace(/\.JK$/, '')
}

async function main() {
  const res = await fetch(SRC, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`)
  const json = (await res.json()) as {
    updated: string
    source: string
    total: number
    stocks: Array<Record<string, unknown>>
  }

  const data: Record<string, ScreenerRow> = {}
  for (const s of json.stocks) {
    const code = normalize(String(s.kode ?? ''))
    if (!code) continue
    data[code] = {
      symbol: code,
      name: String(s.nama ?? ''),
      sector: String(s.sektor ?? ''),
      subsector: String(s.subsektor ?? ''),
      industry: String(s.industri ?? ''),
      subindustry: String(s.subindustri ?? ''),
      per: num(s.per),
      pbv: num(s.pbv),
      der: num(s.der),
      roa: num(s.roa),
      roe: num(s.roe),
      npm: num(s.npm),
      eps: num(s.eps),
      revenue: num(s.rev),
      marketCap: num(s.mktcap),
      price: num(s.harga),
      change1d: num(s.chg1d),
      high52w: num(s.hi52w),
      low52w: num(s.lo52w),
      volume: num(s.vol),
      change4w: num(s.chg4w),
      change13w: num(s.chg13w),
      change26w: num(s.chg26w),
      change52w: num(s.chg52w),
      ytd: num(s.ytd),
    }
  }

  const store: Store = {
    capturedAt: json.updated || new Date().toISOString(),
    source: json.source || 'ihsgscreener.com',
    total: Object.keys(data).length,
    count: Object.keys(data).length,
    data,
  }

  mkdirSync(join(process.cwd(), 'data', 'idx'), { recursive: true })
  writeFileSync(TMP, JSON.stringify(store, null, 2))
  renameSync(TMP, OUT)
  console.log(`OK: ${store.count} stocks → ${OUT}`)
  console.log(`Sample BBCA: ${JSON.stringify(data['BBCA'])}`)
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })