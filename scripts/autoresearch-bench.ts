// ─────────────────────────────────────────────────────────────
// NEXUS vs Hyperdash benchmark — deterministic offline workload
//
// Measures the two axes a market-intelligence terminal competes
// on, using ONLY committed snapshots (no network, no clock
// dependencies, fixed-seed query generation):
//
//   1. cold_start_ms   — parse every committed dataset and build
//                        serving indices from scratch (fresh
//                        process readiness, lower = better)
//   2. bench_ops_per_sec — sustained mixed analytical workload
//                        (lookups / top-K / range filters /
//                        sector aggregations) over those indices,
//                        fixed 4096-operation program (higher =
//                        better)
//   3. instruments     — total instruments indexed (coverage;
//                        Hyperdash tracks one chain's tokens,
//                        NEXUS must index global equities + IDX
//                        depth)
//
// Run via ./autoresearch.sh
// ─────────────────────────────────────────────────────────────

import { readFileSync } from 'fs'
import { join } from 'path'

const DATA = (...p: string[]) => join(process.cwd(), 'data', ...p)

interface UniverseRow { symbol: string; name: string; sector?: string }
interface SahamRow {
  code?: string; symbol?: string
  volume?: number; value?: number; frequency?: number
  foreignBuy?: number; foreignSell?: number; close?: number
}
interface BrokerRow { firm?: string; IDFirm?: string; volume?: number; value?: number; frequency?: number }

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

// ── Dataset loading + indexing (the cold-start path) ─────────

interface Indices {
  universeBySymbol: Map<string, UniverseRow>
  universeBySector: Map<string, string[]>
  sahamByCode: Map<string, SahamRow>
  sahamByForeignNet: Array<{ key: string; net: number }>
  sahamByValue: Array<{ key: string; value: number }>
  brokerByFirm: Map<string, BrokerRow>
  brokerByValue: Array<{ key: string; value: number }>
  foreignSeriesByCode: Map<string, Array<{ date: string; net: number }>>
  fundamentalsByCode: Map<string, Record<string, unknown>>
  instrumentCount: number
}

function buildIndices(): Indices {
  const universe = JSON.parse(readFileSync(DATA('idx', 'universe.json'), 'utf8')) as { stocks: UniverseRow[] }
  const saham = JSON.parse(readFileSync(DATA('idx', 'saham-latest.json'), 'utf8')) as { rows: SahamRow[] }
  const brokers = JSON.parse(readFileSync(DATA('idx', 'brokers-latest.json'), 'utf8')) as { rows?: BrokerRow[] } & Partial<Record<'rows', BrokerRow[]>>
  const foreign = JSON.parse(readFileSync(DATA('idx', 'foreign-history.json'), 'utf8')) as Record<string, Array<{ tradeDate?: string; date?: string; net?: number; foreignNet?: number }>>
  const fundamentals = JSON.parse(readFileSync(DATA('idx', 'fundamentals.json'), 'utf8')) as { data: Record<string, Record<string, unknown>> }

  const universeBySymbol = new Map<string, UniverseRow>()
  const universeBySector = new Map<string, string[]>()
  for (const s of universe.stocks ?? []) {
    universeBySymbol.set(s.symbol, s)
    const sector = s.sector ?? 'Other'
    const bucket = universeBySector.get(sector)
    if (bucket) bucket.push(s.symbol)
    else universeBySector.set(sector, [s.symbol])
  }

  const sahamByCode = new Map<string, SahamRow>()
  const sahamByForeignNet: Array<{ key: string; net: number }> = []
  const sahamByValue: Array<{ key: string; value: number }> = []
  for (const r of saham.rows ?? []) {
    const key = String(r.code ?? r.symbol ?? '')
    if (!key) continue
    sahamByCode.set(key, r)
    const fb = typeof r.foreignBuy === 'number' ? r.foreignBuy : 0
    const fs = typeof r.foreignSell === 'number' ? r.foreignSell : 0
    sahamByForeignNet.push({ key, net: fb - fs })
    if (typeof r.value === 'number') sahamByValue.push({ key, value: r.value })
  }
  sahamByForeignNet.sort((a, b) => b.net - a.net)
  sahamByValue.sort((a, b) => b.value - a.value)

  const brokerRows = brokers.rows ?? (Array.isArray(brokers) ? (brokers as unknown as BrokerRow[]) : [])
  const brokerByFirm = new Map<string, BrokerRow>()
  const brokerByValue: Array<{ key: string; value: number }> = []
  for (const b of brokerRows) {
    const key = String(b.firm ?? b.IDFirm ?? '')
    if (!key) continue
    brokerByFirm.set(key, b)
    if (typeof b.value === 'number') brokerByValue.push({ key, value: b.value })
  }
  brokerByValue.sort((a, b) => b.value - a.value)

  const foreignSeriesByCode = new Map<string, Array<{ date: string; net: number }>>()
  for (const [code, series] of Object.entries(foreign)) {
    if (!Array.isArray(series)) continue
    foreignSeriesByCode.set(
      code,
      series.map((e) => ({ date: String(e.tradeDate ?? e.date ?? ''), net: Number(e.net ?? e.foreignNet ?? 0) })).filter((e) => e.date),
    )
  }

  const fundamentalsByCode = new Map<string, Record<string, unknown>>(Object.entries(fundamentals.data ?? {}))

  return {
    universeBySymbol,
    universeBySector,
    sahamByCode,
    sahamByForeignNet,
    sahamByValue,
    brokerByFirm,
    brokerByValue,
    foreignSeriesByCode,
    fundamentalsByCode,
    instrumentCount: universeBySymbol.size + sahamByCode.size + brokerByFirm.size + foreignSeriesByCode.size + fundamentalsByCode.size,
  }
}

// ── Fixed analytical workload (4096 ops, seeded stream) ───────

const OPS = 4096

type OpKind = 'lookup' | 'topK' | 'rangeFilter' | 'sectorAgg' | 'seriesScan' | 'fundLookup'
const OP_KINDS: OpKind[] = ['lookup', 'topK', 'rangeFilter', 'sectorAgg', 'seriesScan', 'fundLookup']

function runWorkload(idx: Indices, rand: () => number): number {
  // Materialize stable pools once (outside op counting — same for every run).
  const universeSymbols = [...idx.universeBySymbol.keys()]
  const sectors = [...idx.universeBySector.keys()]
  const codes = [...idx.sahamByCode.keys()]
  const fundCodes = [...idx.fundamentalsByCode.keys()]

  let checksum = 0

  for (let i = 0; i < OPS; i++) {
    const kind = OP_KINDS[Math.floor(rand() * OP_KINDS.length)]
    switch (kind) {
      case 'lookup': {
        const sym = universeSymbols[Math.floor(rand() * universeSymbols.length)]
        checksum += idx.universeBySymbol.has(sym) ? 1 : 0
        const code = codes[Math.floor(rand() * codes.length)]
        const row = idx.sahamByCode.get(code)
        if (row && typeof row.volume === 'number') checksum += row.volume % 7
        break
      }
      case 'topK': {
        const k = 5 + Math.floor(rand() * 20)
        const src = rand() < 0.5 ? idx.sahamByForeignNet : idx.brokerByValue
        for (let j = 0; j < k && j < src.length; j++) checksum += src[j] ? 1 : 0
        break
      }
      case 'rangeFilter': {
        const lo = rand() * 1e9
        let hits = 0
        for (const v of idx.sahamByValue) {
          if (v.value >= lo) hits++
          else break
        }
        checksum += hits % 13
        break
      }
      case 'sectorAgg': {
        const sector = sectors[Math.floor(rand() * sectors.length)]
        const syms = idx.universeBySector.get(sector) ?? []
        for (const s of syms) {
          const row = idx.sahamByCode.get(s.replace('.JK', ''))
          if (row && typeof row.close === 'number') checksum += 1
        }
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
  const t0 = performance.now()
  const idx = buildIndices()
  const coldStartMs = performance.now() - t0

  // Warm pass (JIT stabilization) then 3 measured passes, median kept —
  // same fixed seed each pass → identical operation stream.
  const rand0 = mulberry32(1337)
  runWorkload(idx, rand0)

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
  console.log(`# checksum=${lastChecksum} (integrity guard — must be constant across runs)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
