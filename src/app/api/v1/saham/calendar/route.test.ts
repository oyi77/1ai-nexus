// Q4 — calendar 503 split: anonymous gets a generic message (no staging
// hint, no token names); admin gets the actionable staging hint.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/admin-auth', () => ({
  requireAdmin: vi.fn(),
}))

vi.mock('@/lib/modules/market/provider/idx-calendar', () => ({
  getCalendar: vi.fn(),
}))

vi.mock('@/lib/modules/market/provider/idx-stockbit', () => ({
  EmptySnapshotError: class EmptySnapshotError extends Error {},
}))

const { requireAdmin } = await import('@/lib/admin-auth')
const { getCalendar } = await import('@/lib/modules/market/provider/idx-calendar')
const { EmptySnapshotError } = await import('@/lib/modules/market/provider/idx-stockbit')
const { GET } = await import('./route')

beforeEach(() => {
  vi.clearAllMocks()
})

function req() {
  return new NextRequest('http://localhost/api/v1/saham/calendar')
}

describe('GET /api/v1/saham/calendar 503 split (Q4)', () => {
  it('anonymous → 503 generic, no staging hint, no token names', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null)
    vi.mocked(getCalendar).mockRejectedValue(new EmptySnapshotError('Stockbit session (calendar)'))
    const res = await GET(req())
    expect(res.status).toBe(503)
    const raw = await res.text()
    expect(raw).toMatch(/Temporarily unavailable/)
    expect(raw).not.toMatch(/STOCKBIT_REFRESH_TOKEN|Admin|stage/i)
    expect(vi.mocked(requireAdmin)).toHaveBeenCalled()
  })

  it('admin → 503 with actionable staging hint', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ userId: 'admin-1' })
    vi.mocked(getCalendar).mockRejectedValue(new EmptySnapshotError('Stockbit session (calendar)'))
    const res = await GET(req())
    expect(res.status).toBe(503)
    const json = (await res.json()) as { data: unknown; error: string | null }
    expect(json.error).toMatch(/STOCKBIT_REFRESH_TOKEN/)
  })

  it('live data passes through untouched', async () => {
    vi.mocked(getCalendar).mockResolvedValue({ capturedAt: 'x', dividends: [] })
    const res = await GET(req())
    expect(res.status).toBe(200)
    const json = (await res.json()) as { data: { dividends: unknown[] }; error: string | null }
    expect(json.data.dividends).toEqual([])
  })
})
