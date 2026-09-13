// ─────────────────────────────────────────────────────────────
// Telemetry — per-module upstream latency tracking
// Tracks p50/p95 latency per module call; used by the health dashboard
// ─────────────────────────────────────────────────────────────

interface LatencySample {
  module: string
  ms: number
  ok: boolean
  ts: number
}

const MAX_SAMPLES = 500
const samples: LatencySample[] = []

export interface LatencyStats {
  module: string
  calls: number
  failures: number
  p50: number
  p95: number
  avg: number
  lastMs: number
  lastOk: boolean
}

export function record(module: string, ms: number, ok: boolean): void {
  samples.push({ module, ms, ok, ts: Date.now() })
  if (samples.length > MAX_SAMPLES) samples.shift()
}

/** Record the latency of an async operation. */
export async function measure<T>(module: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now()
  try {
    const r = await fn()
    record(module, Date.now() - t0, true)
    return r
  } catch (e) {
    record(module, Date.now() - t0, false)
    throw e
  }
}

export function stats(module?: string): LatencyStats[] {
  const relevant = module ? samples.filter((s) => s.module === module) : samples
  const byModule = new Map<string, LatencySample[]>()
  for (const s of relevant) {
    const arr = byModule.get(s.module) ?? []
    arr.push(s)
    byModule.set(s.module, arr)
  }
  const out: LatencyStats[] = []
  for (const [mod, arr] of byModule) {
    const sorted = [...arr].sort((a, b) => a.ms - b.ms)
    const fails = arr.filter((s) => !s.ok)
    const pct = (p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].ms : 0
    out.push({
      module: mod,
      calls: arr.length,
      failures: fails.length,
      p50: pct(0.5),
      p95: pct(0.95),
      avg: arr.reduce((s, x) => s + x.ms, 0) / arr.length,
      lastMs: arr[arr.length - 1]?.ms ?? 0,
      lastOk: arr[arr.length - 1]?.ok ?? false,
    })
  }
  return out.sort((a, b) => b.p95 - a.p95)
}

export function clear(): void {
  samples.length = 0
}
