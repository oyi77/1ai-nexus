// Direct GET-handler unit test for /api/v1/macro.
// No server, no port, no auth, no network: exercises route.ts logic in isolation.
// `category` flows from the static FRED_SERIES map (route.ts:46 / catch at :55),
// so it is asserted present whether FRED is reachable or throws offline.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from './route'
import { NextRequest } from 'next/server'
import * as fredClient from '@/lib/fred-client'

vi.mock('@/lib/fred-client', () => ({
  getFredSeries: vi.fn(),
}))

const mockGet = fredClient.getFredSeries as unknown as ReturnType<typeof vi.fn>

async function call(url: string) {
  const res = await GET(new NextRequest(url))
  const body = (await res.json()) as {
    data: any
    meta?: unknown
    error: string | null
  }
  return { status: res.status, ...body }
}

describe('GET /api/v1/macro (handler unit test)', () => {
  beforeEach(() => {
    mockGet.mockReset()
  })

  it('action=all: category on every indicator, even when FRED is offline', async () => {
    mockGet.mockRejectedValue(new Error('offline FRED'))
    const r = (await call('http://localhost/api/v1/macro?action=all')) as any
    expect(r.status).toBe(200)
    expect(Array.isArray(r.data.indicators)).toBe(true)
    expect(r.data.indicators).toHaveLength(19)
    expect(typeof r.data.indicators[0].category).toBe('string')
    for (const ind of r.data.indicators) {
      expect(typeof ind.category).toBe('string')
      expect(ind.category.length).toBeGreaterThan(0)
    }
  })

  it('action=all: success path also emits category + latestValue', async () => {
    mockGet.mockResolvedValue({ observations: [{ date: '2026-07-01', value: '3.63' }] })
    const r = (await call('http://localhost/api/v1/macro?action=all')) as any
    expect(r.status).toBe(200)
    expect(r.data.indicators).toHaveLength(19)
    expect(r.data.indicators.every((x: any) => typeof x.category === 'string')).toBe(true)
    expect(r.data.indicators[0].latestValue).toBe(3.63)
  })

  it('action=fred/all: data is array of 19, each with category', async () => {
    mockGet.mockRejectedValue(new Error('offline'))
    const r = (await call('http://localhost/api/v1/macro?action=fred/all')) as any
    expect(r.status).toBe(200)
    expect(Array.isArray(r.data)).toBe(true)
    expect(r.data).toHaveLength(19)
    expect(r.data.every((x: any) => typeof x.category === 'string')).toBe(true)
  })

  it('action=fred: single-series object carries category (no indicators[] by design)', async () => {
    mockGet.mockResolvedValue({ observations: [{ date: '2026-07-01', value: '3.63' }] })
    const r = (await call('http://localhost/api/v1/macro?action=fred&series=FEDFUNDS')) as any
    expect(r.status).toBe(200)
    expect(r.data.seriesId).toBe('FEDFUNDS')
    expect(typeof r.data.category).toBe('string')
    expect(r.data.indicators).toBeUndefined()
  })

  it('action=health: fredAvailable is boolean + 200 (false when offline)', async () => {
    mockGet.mockRejectedValue(new Error('offline'))
    const r = (await call('http://localhost/api/v1/macro?action=health')) as any
    expect(r.status).toBe(200)
    expect(typeof r.data.fredAvailable).toBe('boolean')
    expect(r.data.fredAvailable).toBe(false)
  })

  it('action=health: fredAvailable true when FRED reachable', async () => {
    mockGet.mockResolvedValue({ observations: [{ date: '2026-07-01', value: '3.63' }] })
    const r = (await call('http://localhost/api/v1/macro?action=health')) as any
    expect(r.status).toBe(200)
    expect(r.data.fredAvailable).toBe(true)
  })
  it('action=regime: indicators are {seriesId,value} — NO category (intentional, distinct from all/fred/all)', async () => {
    mockGet.mockResolvedValue({ observations: [{ date: '2026-07-01', value: '3.63' }] })
    const r = (await call('http://localhost/api/v1/macro?action=regime')) as any
    expect(r.status).toBe(200)
    expect(typeof r.data.regime?.label).toBe('string')
    expect(typeof r.data.regime?.score).toBe('number')
    expect(Array.isArray(r.data.indicators)).toBe(true)
    // Regime intentionally maps to {seriesId,value} only; category is NOT part of this shape.
    for (const ind of r.data.indicators) {
      expect(typeof ind.seriesId).toBe('string')
      expect(typeof ind.value).toBe('number')
      expect(ind.category).toBeUndefined()
    }
  })
})
