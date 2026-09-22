import { test, expect } from 'vitest'
import {
  getFundingCells,
  getSectorCells,
  getForeignCells,
  refreshBriefCalibration,
} from '@/lib/modules/derived/brief-calibration'

/**
 * Brief calibration store — measured leg cells must refresh from live
 * tables, never go stale silently, and always degrade to the baked
 * fallback instead of throwing.
 */
test('calibration store: live cells with honest asOf + safe fallbacks', async () => {
  const [f, s, g] = await Promise.all([getFundingCells(), getSectorCells(), getForeignCells()])

  // Funding: at least one known exchange with long+short tiers.
  const ex = f.cells.Binance ?? f.cells.Bybit
  expect(ex).toBeDefined()
  expect(ex.long).toBeDefined()
  expect(ex.short).toBeDefined()
  const totalN = Object.values(f.cells).flatMap((byEx) =>
    Object.values(byEx).flatMap((byTier) => Object.values(byTier).map((c) => c.n)),
  ).reduce((a, b) => a + b, 0)
  expect(totalN).toBeGreaterThan(100)
  expect(f.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/)

  // Sector: both sides with real samples.
  expect(s.top.n).toBeGreaterThanOrEqual(20)
  expect(s.bottom.n).toBeGreaterThanOrEqual(20)
  expect(s.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/)

  // Foreign: cross-sectional edge fields present.
  expect(g.days).toBeGreaterThanOrEqual(10)
  expect(typeof g.spreadPp).toBe('number')
  expect(typeof g.rankIC).toBe('number')
  expect(g.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/)

  // Refresher seam returns all three stamps.
  const stamps = await refreshBriefCalibration()
  expect(stamps.funding).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(stamps.sector).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(stamps.foreign).toMatch(/^\d{4}-\d{2}-\d{2}$/)
}, 300_000)
