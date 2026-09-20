import { test, expect } from 'vitest'
import { buildInsightBrief } from '@/lib/modules/derived/insight-brief'

/**
 * Insight Brief — cross-domain transmission engine.
 *
 * Guards the two defects this engine was rebuilt to fix:
 *  1. Per-symbol funding stats must be exact window stats (a row-capped fetch
 *     biases mean/sd to the newest slice), so z-scores stay sane.
 *  2. Crowding side comes from the funding RATE SIGN, never the z sign —
 *     mis-keying it printed "crowded shorts" for a positive funding rate.
 *  3. No transmission may claim measured confidence without a real sample.
 */
test('insight brief: honest provenance, correct crowding side, sane z', async () => {
  const brief = await buildInsightBrief()

  expect(['risk-on', 'risk-off', 'mixed']).toContain(brief.regime)
  expect(brief.transmissions.length).toBeGreaterThan(0)

  for (const t of brief.transmissions) {
    expect(t.evidence.length).toBeGreaterThan(0)
    expect(typeof t.unproven).toBe('boolean')
    // Unproven legs are pinned to the neutral 50 so no unmeasured read gates a trade.
    if (t.unproven) expect(t.confidence).toBe(50)
    // Measured legs must cite a real sample, not an assumption.
    if (!t.unproven) expect(t.measured?.n ?? 0).toBeGreaterThanOrEqual(20)
  }

  const funding = brief.transmissions.filter((t) => t.id.startsWith('funding:'))
  for (const f of funding) {
    const z = Number(f.evidence[0].value)
    // Direction must follow the funding rate sign, not the z sign.
    const rate = Number(/([+-]?\d+\.\d+)%/.exec(f.from)?.[1] ?? '0')
    expect(f.direction).toBe(rate > 0 ? 'bearish' : 'bullish')
    expect(f.narrative).toContain(rate > 0 ? 'Crowded longs' : 'Crowded shorts')
    // Exact SQL stats cannot produce a degenerate or absurd z.
    expect(Number.isFinite(z)).toBe(true)
    expect(Math.abs(z)).toBeGreaterThanOrEqual(2)
    expect(Math.abs(z)).toBeLessThan(60)
  }

  // Sector leg must report two distinct sides, never the same sector twice.
  const sector = brief.transmissions.find((t) => t.id === 'sector-rotation')
  if (sector) {
    const inflow = sector.evidence.filter((e) => e.metric.startsWith('inflow ·')).map((e) => e.metric.slice(9))
    const outflow = sector.evidence.filter((e) => e.metric.startsWith('outflow ·')).map((e) => e.metric.slice(10))
    expect(outflow.length).toBeGreaterThan(0)
    for (const s of outflow) expect(inflow).not.toContain(s)
  }
}, 90_000)
