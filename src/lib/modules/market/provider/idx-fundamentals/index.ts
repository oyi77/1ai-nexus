// ─────────────────────────────────────────────────────────────
// IDX Fundamentals provider — reads the nightly snapshot written
// by src/scripts/idx-fundamentals-harvest.ts (TradingView scan,
// single-shot). Zero runtime upstream calls.
//
// Units contract (set by the harvester):
//   per/pbv multiples · roe % · der ratio · eps IDR ·
//   marketCap IDR · dividendYield %
// ─────────────────────────────────────────────────────────────

import { readFileSync } from 'fs'
import { join } from 'path'
import { getCached } from '@/lib/api/server-cache'

export interface FundRow {
  per?: number | null
  pbv?: number | null
  roe?: number | null
  der?: number | null
  eps?: number | null
  marketCap?: number | null
  dividendYield?: number | null
}

interface Snapshot {
  capturedAt: string
  done: string[]
  data: Record<string, FundRow>
}

const SNAPSHOT = join(process.cwd(), 'data', 'idx', 'fundamentals.json')
const CACHE_TTL = 10 * 60 * 1000

async function loadSnapshot(): Promise<Snapshot | null> {
  const { data } = await getCached('idx-fundamentals:v1', CACHE_TTL, async () => {
    try {
      return JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as Snapshot
    } catch {
      // Harvest never ran / file missing — serve an empty snapshot.
      return { capturedAt: '', done: [], data: {} }
    }
  })
  return data
}

/** Normalize user input: 'BBCA.JK'/'bbca' → 'BBCA'. */
export function normalizeCode(input: string): string {
  return input.trim().toUpperCase().replace(/\.JK$/, '')
}

export async function getFundamentalsSnapshot(): Promise<{
  capturedAt: string
  count: number
  data: Record<string, FundRow>
}> {
  const snap = await loadSnapshot()
  return { capturedAt: snap?.capturedAt ?? '', count: snap?.done.length ?? 0, data: snap?.data ?? {} }
}

export async function getFundamentals(code: string): Promise<FundRow | null> {
  const snap = await loadSnapshot()
  return snap?.data[normalizeCode(code)] ?? null
}
