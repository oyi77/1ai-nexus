import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

// The middleware snapshots NEXUS_API_KEYS at module load, so the key set must
// exist before the import is evaluated.
vi.hoisted(() => {
  process.env.NEXUS_API_KEYS = 'known-key-for-tests'
})

const { middleware } = await import('../../middleware')

/**
 * Behavioural tests against the real middleware.
 *
 * These pin the two properties that were broken in production:
 *  1. Market-data routes must be readable by a first-party browser.
 *  2. The browser exemption must be derived from a header script cannot forge,
 *     never from `x-csrf-token` (which any caller can send).
 */

const ORIGIN = 'https://tracker.aitradepulse.com'

function req(
  path: string,
  { fetchSite, csrf, bearer, method = 'GET' }: {
    fetchSite?: string
    csrf?: string
    bearer?: string
    method?: string
  } = {},
) {
  const headers = new Headers()
  if (fetchSite) headers.set('sec-fetch-site', fetchSite)
  if (csrf) headers.set('x-csrf-token', csrf)
  if (bearer) headers.set('authorization', `Bearer ${bearer}`)
  if (fetchSite) headers.set('referer', ORIGIN + '/dashboard')
  return new NextRequest(`${ORIGIN}${path}`, { method, headers })
}

describe('middleware route classification', () => {
  describe('first-party browser access to market data', () => {
    const marketData = [
      '/api/v1/forex',
      '/api/v1/ohlcv',
      '/api/v1/global-macro',
      '/api/v1/insider',
      '/api/v1/orderbook',
      '/api/v1/intelligence-score',
      '/api/v1/meme/leaderboard',
      '/api/v1/saham/watchlist-ideas',
      '/api/v1/defi/overview',
      '/api/v1/sectors',
    ]

    for (const path of marketData) {
      it(`allows a same-origin browser to read ${path}`, async () => {
        const res = await middleware(req(path, { fetchSite: 'same-origin' }))
        expect(res.status).not.toBe(401)
      })
    }

    it('does not require a credential for an allowlisted public route even cross-site', async () => {
      const res = await middleware(req('/api/v1/health', { fetchSite: 'cross-site' }))
      expect(res.status).not.toBe(401)
    })
  })

  describe('browser exemption cannot be forged', () => {
    // `/api/v1/pnl` is neither public nor protected: readable by a first-party
    // browser, but a third party must present an API key.
    it('rejects a cross-site request carrying a CSRF token', async () => {
      const res = await middleware(
        req('/api/v1/pnl', { fetchSite: 'cross-site', csrf: 'attacker-supplied' }),
      )
      expect(res.status).toBe(401)
    })

    it('rejects a request that only supplies x-csrf-token and no origin signal', async () => {
      const res = await middleware(req('/api/v1/pnl', { csrf: 'attacker-supplied' }))
      expect(res.status).toBe(401)
    })

    it('accepts a valid API key from a non-browser caller', async () => {
      const res = await middleware(req('/api/v1/pnl', { bearer: 'known-key-for-tests' }))
      expect(res.status).not.toBe(401)
    })

    it('rejects an unknown API key', async () => {
      const res = await middleware(req('/api/v1/pnl', { bearer: 'not-a-real-key' }))
      expect(res.status).toBe(401)
    })
  })

  describe('the module executor is gated per module', () => {
    // Public market pages fetch these straight from the browser, so an
    // unauthenticated request from a first-party page must be allowed.
    const allowlisted = [
      '/api/v1/modules/fetch?module=yahoo-finance&action=quote&symbols=AAPL',
      '/api/v1/modules/fetch?module=defillama&action=protocols',
      '/api/v1/modules/fetch?module=coingecko&action=global',
      '/api/v1/modules/fetch?module=deribit-options&action=options-chain&currency=BTC',
    ]
    for (const path of allowlisted) {
      it(`allows an unauthenticated fetch of ${path.split('module=')[1].split('&')[0]}`, async () => {
        const res = await middleware(req(path))
        expect(res.status).not.toBe(401)
      })
    }

    it('still gates a module that is not allowlisted', async () => {
      const res = await middleware(req('/api/v1/modules/fetch?module=finnhub-re&action=quote'))
      expect(res.status).toBe(401)
    })

    it('gates the executor itself when no module is named', async () => {
      const res = await middleware(req('/api/v1/modules/fetch'))
      expect(res.status).toBe(401)
    })

    it('does not let a query string un-gate an unrelated protected route', async () => {
      const res = await middleware(req('/api/v1/watchlist?module=yahoo-finance'))
      expect(res.status).toBe(401)
    })
  })

  describe('user-scoped and premium routes always require authentication', () => {
    const guarded = [
      '/api/v1/account/me',
      '/api/v1/admin/users',
      '/api/v1/watchlist',
      '/api/v1/payments/history',
      '/api/v1/telegram/broadcast',
      '/api/v1/alpha-engine',
      '/api/v1/sfc',
      '/api/v1/opportunities',
      '/api/v1/backtest',
      '/api/v1/signals/history',
      '/api/v1/paper-trades',
      '/api/v1/user/api-key',
      '/api/v1/cron/start',
    ]

    for (const path of guarded) {
      it(`rejects an anonymous browser on ${path}`, async () => {
        const res = await middleware(req(path, { fetchSite: 'same-origin', csrf: 'anything' }))
        expect(res.status).toBe(401)
      })
    }

    it('does not let a public prefix exempt an explicitly protected route', async () => {
      // `/api/v1/token/` is a public prefix; `/api/v1/signals/history` is protected.
      const res = await middleware(req('/api/v1/signals/history', { fetchSite: 'same-origin' }))
      expect(res.status).toBe(401)
    })
  })

  describe('preflight and non-API paths', () => {
    it('answers CORS preflight without authenticating', async () => {
      const res = await middleware(
        req('/api/v1/watchlist', { method: 'OPTIONS', fetchSite: 'cross-site' }),
      )
      expect(res.status).toBe(204)
    })

    it('does not gate page routes', async () => {
      const res = await middleware(req('/dashboard'))
      expect(res.status).not.toBe(401)
    })
  })
})
