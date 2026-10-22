// ─────────────────────────────────────────────────────────────
// Moby dual-account fallback tests (fixture-backed, no network).
// Covers: primary dead → fallback serves; both dead → primary error.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  resolveMobyAccessToken,
  resetMobySession,
  hasMobyFallbackCredentials,
} from '../moby/session'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'moby-fb-'))
  process.env.MOBY_SESSION_PATH = join(dir, 'primary.json')
  process.env.MOBY_FALLBACK_SESSION_PATH = join(dir, 'fallback.json')
  delete process.env.MOBY_API_KEY
  delete process.env.MOBY_REFRESH_TOKEN
  delete process.env.MOBY_EMAIL
  delete process.env.MOBY_FALLBACK_API_KEY
  delete process.env.MOBY_FALLBACK_REFRESH_TOKEN
  delete process.env.MOBY_FALLBACK_EMAIL
  // Kill-switch: prevent the backfilled live DB SessionToken row from
  // shadowing per-test temp session files. Mirrors SNIPER_SEEN_DB pattern.
  process.env.SESSION_DB = 'off'
  resetMobySession()
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.MOBY_SESSION_PATH
  delete process.env.MOBY_FALLBACK_SESSION_PATH
  delete process.env.SESSION_DB
  rmSync(dir, { recursive: true, force: true })
})

// The mock signs with a fixed exp, so the expectation must match byte for
// byte. Deriving exp from Date.now() at assertion time made this test fail
// whenever the second ticked over between the fetch and the expect.
function freshToken(n: string): string {
  return (
    'aaa.' +
    Buffer.from(JSON.stringify({ exp: 1_900_000_000, n })).toString('base64url') +
    '.bbb'
  )
}

function mockPrivy(primaryOk: boolean): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? '{}')
      const rt: string = body.refresh_token ?? ''
      if (rt.startsWith('rt-fb')) {
        // Fallback account: always rotates fine.
        return new Response(
          JSON.stringify({ token: freshToken('fb'), refresh_token: 'rt-fb-rotated' }),
          { status: 200 },
        )
      }
      // Primary account: behavior per test.
      if (primaryOk) {
        return new Response(
          JSON.stringify({ token: freshToken('primary'), refresh_token: 'rt-p-rotated' }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ error: 'revoked' }), { status: 401 })
    }),
  )
}

describe('moby dual-account fallback', () => {
  it('primary works → fallback untouched', async () => {
    process.env.MOBY_API_KEY = 'stale.primary.sig'
    process.env.MOBY_REFRESH_TOKEN = 'rt-primary'
    process.env.MOBY_FALLBACK_API_KEY = 'stale.fb.sig'
    process.env.MOBY_FALLBACK_REFRESH_TOKEN = 'rt-fb'
    mockPrivy(true)
    const tok = await resolveMobyAccessToken()
    expect(tok).toBe(freshToken('primary'))
    expect(hasMobyFallbackCredentials()).toBe(true)
  })

  it('primary dead (no email) + fallback configured → serves fallback token', async () => {
    process.env.MOBY_API_KEY = 'stale.primary.sig'
    process.env.MOBY_REFRESH_TOKEN = 'rt-primary'
    process.env.MOBY_FALLBACK_API_KEY = 'stale.fb.sig'
    process.env.MOBY_FALLBACK_REFRESH_TOKEN = 'rt-fb'
    mockPrivy(false)
    const tok = await resolveMobyAccessToken()
    expect(tok).toBe(freshToken('fb'))
  })

  it('both dead → primary error surfaces, not fallback shadow', async () => {
    process.env.MOBY_API_KEY = 'stale.primary.sig'
    process.env.MOBY_REFRESH_TOKEN = 'rt-primary'
    process.env.MOBY_FALLBACK_API_KEY = 'stale.fb.sig'
    process.env.MOBY_FALLBACK_REFRESH_TOKEN = 'rt-fb-dead'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'x' }), { status: 401 })),
    )
    await expect(resolveMobyAccessToken()).rejects.toThrow('Privy session revoked')
  })

  it('no fallback configured → hasMobyFallbackCredentials false, error unchanged', async () => {
    expect(hasMobyFallbackCredentials()).toBe(false)
    await expect(resolveMobyAccessToken()).rejects.toThrow('No Moby session')
  })
})
