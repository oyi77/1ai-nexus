// ─────────────────────────────────────────────────────────────
// IDX Screener provider — reads the snapshot written by
// src/scripts/idx-screener-harvest.ts. Zero runtime upstream.
//
// Units contract:
//   per/pbv multiples · der ratio · roa/roe/npm % · eps IDR ·
//   revenue IDR · marketCap IDR · price IDR · change1d % ·
//   hi52w/lo52w IDR · volume shares · change4w/13w/26w/52w % · ytd %
// ─────────────────────────────────────────────────────────────

import { readFileSync } from 'fs'
import { join } from 'path'
import { getCached } from '@/lib/api/server-cache'

export interface ScreenerRow {
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

interface Snapshot {
  capturedAt: string
  source: string
  total: number
  count: number
  data: Record<string, ScreenerRow>
}

const SNAPSHOT = join(process.cwd(), 'data', 'idx', 'screener.json')
const CACHE_TTL = 10 * 60 * 1000

async function loadSnapshot(): Promise<Snapshot | null> {
  const { data } = await getCached('idx-screener:v1', CACHE_TTL, async () => {
    try {
      return JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as Snapshot
    } catch {
      return { capturedAt: '', source: '', total: 0, count: 0, data: {} }
    }
  })
  return data
}

export function normalizeCode(input: string): string {
  return input.trim().toUpperCase().replace(/\.JK$/, '')
}

export async function getScreenerSnapshot(): Promise<{
  capturedAt: string
  source: string
  total: number
  count: number
  data: Record<string, ScreenerRow>
}> {
  const snap = await loadSnapshot()
  return {
    capturedAt: snap?.capturedAt ?? '',
    source: snap?.source ?? '',
    total: snap?.total ?? 0,
    count: snap?.count ?? 0,
    data: snap?.data ?? {},
  }
}

export async function getScreenerStock(code: string): Promise<ScreenerRow | null> {
  const snap = await loadSnapshot()
  return snap?.data[normalizeCode(code)] ?? null
}

export async function getScreenerBySector(sector: string): Promise<ScreenerRow[]> {
  const snap = await loadSnapshot()
  return Object.values(snap?.data ?? {}).filter(
    (r) => r.sector.toLowerCase() === sector.toLowerCase()
  )
}

export async function getTopMovers(
  n = 20,
  direction: 'gainers' | 'losers' = 'gainers'
): Promise<ScreenerRow[]> {
  const snap = await loadSnapshot()
  const items = Object.values(snap?.data ?? {}).filter((r) => r.change1d != null)
  items.sort((a, b) =>
    direction === 'gainers'
      ? (b.change1d ?? 0) - (a.change1d ?? 0)
      : (a.change1d ?? 0) - (b.change1d ?? 0)
  )
  return items.slice(0, n)
}