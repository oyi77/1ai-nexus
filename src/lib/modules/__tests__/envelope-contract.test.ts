// ─────────────────────────────────────────────────────────────
// Envelope contract tests — verify API routes return valid envelopes.
// The fear-greed bug returned {data:{}, error:null} — these tests
// assert "data is either a complete object or null, never {}".
// ─────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest'

const BASE = process.env.TEST_BASE_URL || 'http://localhost:4400'

async function api(path: string) {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(30_000) })
  const json = await res.json() as { data: unknown; error: string | null; meta?: unknown }
  return { status: res.status, ...json }
}

function isValidEnvelope(data: unknown, error: string | null): { ok: boolean; reason?: string } {
  // Error case: data should be null, error should be a string
  if (error) {
    if (data !== null) return { ok: false, reason: `error=${error} but data is not null` }
    return { ok: true }
  }
  // Success case: data must not be null, must not be empty {}
  if (data === null || data === undefined) return { ok: false, reason: 'success but data is null' }
  if (typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0) {
    return { ok: false, reason: 'success but data is {} (empty object)' }
  }
  return { ok: true }
}

describe('Envelope Contract', () => {
  const routes = [
    '/api/v1/fear-greed',
    '/api/v1/market/prices',
    '/api/v1/news?limit=5',
    '/api/v1/global-macro',
    '/api/v1/indonesia-macro',
    '/api/v1/whale-alert',
    '/api/v1/dex/trending?network=solana',
  ]

  for (const route of routes) {
    it(`${route} returns a valid envelope`, async () => {
      const { status, data, error } = await api(route)
      // Accept 200 or graceful failure (502/504 for upstream timeouts)
      expect([200, 502, 504]).toContain(status)
      const check = isValidEnvelope(data, error)
      expect(check.ok, check.reason).toBe(true)
    }, 30_000)
  }

  it('fear-greed: data.composite is a complete object when present', async () => {
    const { status, data } = await api('/api/v1/fear-greed')
    if (status === 200 && data) {
      const d = data as Record<string, unknown>
      if (d.composite) {
        const comp = d.composite as Record<string, unknown>
        expect(typeof comp.score).toBe('number')
        expect(comp.score).toBeGreaterThanOrEqual(0)
        expect(comp.score).toBeLessThanOrEqual(100)
      }
    }
  })
})
