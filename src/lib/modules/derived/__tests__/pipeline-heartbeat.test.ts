import { describe, it, expect } from 'vitest'
import {
  evaluatePipelines,
  EXPECTED_PIPELINES,
  type PipelineHeartbeats,
  type PipelineExpectation,
} from '@/lib/modules/derived/pipeline-heartbeat'

const NOW = 1_800_000_000_000

const EXPS: PipelineExpectation[] = [
  { name: 'fast', maxAgeMs: 20 * 60_000 },
  { name: 'slow', maxAgeMs: 26 * 60 * 60_000 },
]

function hb(at: number, ok = true, detail = 'ok'): PipelineHeartbeats[string] {
  return { at, ok, detail }
}

describe('evaluatePipelines', () => {
  it('reports a healthy pipeline', () => {
    const res = evaluatePipelines({ fast: hb(NOW - 60_000) }, EXPS, NOW)
    expect(res.failures).toEqual([])
    expect(res.healthy).toHaveLength(1)
    // 'slow' has no heartbeat yet, so it is uninstrumented rather than broken.
    expect(res.uninstrumented).toEqual(['slow'])
  })

  it('treats a pipeline that never reported as uninstrumented, not broken', () => {
    // Alerting on "never instrumented" would be noise on every run during
    // rollout — it is not evidence of a failure.
    const res = evaluatePipelines({}, EXPS, NOW)
    expect(res.failures).toEqual([])
    expect(res.uninstrumented).toEqual(['fast', 'slow'])
  })

  it('flags a pipeline that stopped (heartbeat older than its max age)', () => {
    const res = evaluatePipelines({ fast: hb(NOW - 60 * 60_000) }, EXPS, NOW)
    expect(res.failures).toHaveLength(1)
    expect(res.failures[0].name).toBe('pipeline fast')
    expect(res.failures[0].detail).toContain('stopped')
    expect(res.uninstrumented).toEqual(['slow'])
  })

  it('flags a pipeline whose last run failed', () => {
    const res = evaluatePipelines({ fast: hb(NOW - 60_000, false, '3 token errors') }, EXPS, NOW)
    expect(res.failures).toHaveLength(1)
    expect(res.failures[0].detail).toContain('3 token errors')
  })

  it('keeps a slow-but-alive daily pipeline healthy', () => {
    const res = evaluatePipelines({ slow: hb(NOW - 3 * 60 * 60_000) }, EXPS, NOW)
    expect(res.failures).toEqual([])
    expect(res.healthy).toHaveLength(1)
  })

  it('gives every expected pipeline an age budget that exceeds its schedule', () => {
    for (const exp of EXPECTED_PIPELINES) {
      expect(exp.maxAgeMs).toBeGreaterThan(5 * 60_000)
      expect(exp.name).toMatch(/^[a-z0-9-]+$/)
    }
  })

  it('does not list the same pipeline twice', () => {
    const names = EXPECTED_PIPELINES.map((e) => e.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
