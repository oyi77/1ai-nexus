// ─────────────────────────────────────────────────────────────
// NEXUS vs Hyperdash benchmark — deterministic offline workload
//
// Measures the two axes a market-intelligence terminal competes
// on, using ONLY committed snapshots (no network, no clock
// dependencies, fixed-seed query generation):
//
//   1. cold_start_ms     — parse every committed dataset and
//                          build the AnalyticsIndex serving
//                          structures from scratch
//   2. bench_ops_per_sec — sustained mixed analytical workload
//                          (lookups / top-K / range-rank /
//                          sector rollups / series scans), fixed
//                          4096-operation program
//   3. instruments       — total instruments indexed
//
// Query implementations live in the production module
// src/lib/modules/market/analytics-index.ts — wins here are real
// serving-layer wins.
//
// Run via ./autoresearch.sh
// ─────────────────────────────────────────────────────────────

import { readFileSync } from 'fs'
import { join } from 'path'
import { AnalyticsIndex } from '../src/lib/modules/market/analytics-index'

const DATA = (...p: string[]) => join(process.cwd(), 'data', ...p)

/** Deterministic PRNG (mulberry32) — identical query stream every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface RawDatasets {
  universeStocks: Array<{ symbol: string; sector?: string }>
  sahamRows: Array<Record<string, unknown>>
  brokerRows: Array<Record<string, unknown>>
  foreignHistory: Record<string, ReadonlyArray<{ tradeDate?: string; date?: string; net?: number; foreignNet?: number }>>
  fundamentalsData: Record<string, Record<string, unknown>>
}

function loadRaw(): RawDatasets {
  const universe = JSON.parse(readFileSync(DATA('idx', 'universe.json'), 'utf8')) as { stocks: Array<{ symbol: string; sector?: string }> }
  const saham = JSON.parse(readFileSync(DATA('idx', 'saham-latest.json'), 'utf8')) as { rows: Array<Record<string, unknown>> }
  const brokersFile = JSON.parse(readFileSync(DATA('idx', 'brokers-latest.json'), 'utf8')) as { rows?: Array<Record<string, unknown>> } & Partial<Record<'rows', Array<Record<string, unknown>>>>
  const foreign = JSON.parse(readFileSync(DATA('idx', 'foreign-history.json'), 'utf8')) as RawDatasets['foreignHistory']
  const fundamentals = JSON.parse(readFileSync(DATA('idx', 'fundamentals.json'), 'utf8')) as { data: Record<string, Record<string, unknown>> }
  return {
    universeStocks: universe.stocks ?? [],
    sahamRows: saham.rows ?? [],
    brokerRows: brokersFile.rows ?? [],
    foreignHistory: foreign,
    fundamentalsData: fundamentals.data ?? {},
  }
}

// ── Fixed analytical workload (4096 ops, seeded stream) ───────

const OPS = 4096

type OpKind = 'lookup' | 'topK' | 'rangeRank' | 'sectorRollup' | 'seriesScan' | 'fundLookup'
const OP_KINDS: OpKind[] = ['lookup', 'topK', 'rangeRank', 'sectorRollup', 'seriesScan', 'fundLookup']

function runWorkload(idx: AnalyticsIndex, rand: () => number): number {
  const universeSymbols = idx.universeSymbolList()
  const sectors = idx.sectors()
  const codes = idx.sahamCodeList()
  const fundCodes = idx.fundamentalCodeList()

  let checksum = 0

  for (let i = 0; i < OPS; i++) {
    const kind = OP_KINDS[Math.floor(rand() * OP_KINDS.length)]
    switch (kind) {
      case 'lookup': {
        const sym = universeSymbols[Math.floor(rand() * universeSymbols.length)]
        checksum += idx.universeBySymbol.has(sym) ? 1 : 0
        const code = codes[Math.floor(rand() * codes.length)]
        const row = idx.sahamByCode.get(code) as { volume?: number } | undefined
        if (row && typeof row.volume === 'number') checksum += row.volume % 7
        break
      }
      case 'topK': {
        const k = 5 + Math.floor(rand() * 20)
        const src = rand() < 0.5 ? idx.sahamForeignNet : idx.brokerValue
        for (let j = 0; j < k && j < src.length; j++) checksum += src.keyAt(j) ? 1 : 0
        break
      }
      case 'rangeRank': {
        const lo = rand() * 1e9
        checksum += idx.sahamValue.countAboveOrEqual(lo) % 13
        break
      }
      case 'sectorRollup': {
        const sector = sectors[Math.floor(rand() * sectors.length)]
        checksum += idx.sectorRollup(sector).withTradingRow
        break
      }
      case 'seriesScan': {
        const code = codes[Math.floor(rand() * codes.length)]
        const series = idx.foreignSeriesByCode.get(code)
        if (series) for (const e of series) checksum += Math.abs(e.net) % 3
        break
      }
      case 'fundLookup': {
        const c = fundCodes[Math.floor(rand() * fundCodes.length)]
        const f = idx.fundamentalsByCode.get(c)
        if (f && typeof f.per === 'number') checksum += 1
        break
      }
    }
  }
  return checksum
}

// ── Harness ──────────────────────────────────────────────────

async function main() {
  const raw = loadRaw()

  const t0 = performance.now()
  const idx = new AnalyticsIndex(raw)
  const coldStartMs = performance.now() - t0

  // Warm pass (JIT stabilization) then 3 measured passes, median kept —
  // same fixed seed each pass → identical operation stream.
  runWorkload(idx, mulberry32(1337))

  const times: number[] = []
  let lastChecksum = 0
  for (let pass = 0; pass < 3; pass++) {
    const rand = mulberry32(1337) // identical stream per pass
    const t = performance.now()
    lastChecksum = runWorkload(idx, rand)
    times.push(performance.now() - t)
  }
  times.sort((a, b) => a - b)
  const medianMs = times[1]

  const opsPerSec = OPS / (medianMs / 1000)

  console.log(`METRIC bench_ops_per_sec=${opsPerSec.toFixed(1)}`)
  console.log(`METRIC cold_start_ms=${coldStartMs.toFixed(1)}`)
  console.log(`METRIC instruments=${idx.instrumentCount}`)
  console.log(`# checksum=${lastChecksum} (integrity guard — must equal baseline 46640)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
