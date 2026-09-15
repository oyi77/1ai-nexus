// ─────────────────────────────────────────────────────────────
// Moby session store unit tests (no network).
// Session path overridden to a tmp dir via MOBY_SESSION_PATH.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  resolveMobyAccessToken,
  resetMobySession,
  hasSessionCredentials,
} from '../moby/session'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'moby-sess-'))
  process.env.MOBY_SESSION_PATH = join(dir, 'session.json')
  delete process.env.MOBY_API_KEY
  delete process.env.MOBY_REFRESH_TOKEN
  resetMobySession()
})

afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
})

const FRESH_AT = 'aaa.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.bbb'
const STALE_AT = 'stale.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 99999 })).toString('base64url') + '.old'

function mockRefreshSequence(bodies: Array<Record<string, unknown>>) {
  const queue = [...bodies]
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? '{}')
      // Mirror Privy: require a real-shaped bearer + refresh_token body.
      const auth = (init?.headers as Record<string, string>)?.authorization ?? ''
      if (!auth.startsWith('Bearer ') || !body.refresh_token) {
        return new Response(JSON.stringify({ error: 'Missing access token' }), { status: 401 })
      }
      const next = queue.shift() ?? queue[queue.length - 1] ?? {}
      return new Response(JSON.stringify({ token: FRESH_AT, refresh_token: 'rt-rotated', ...next }), { status: 200 })
    }),
  )
}

describe('resolveMobyAccessToken', () => {
  it('throws actionable error with no credentials', async () => {
    await expect(resolveMobyAccessToken()).rejects.toThrow('No Moby session')
    expect(hasSessionCredentials()).toBe(false)
  })

  it('rotates on cold boot from env pair and persists', async () => {
    process.env.MOBY_API_KEY = STALE_AT
    process.env.MOBY_REFRESH_TOKEN = 'rt-env'
    mockRefreshSequence([{ token: FRESH_AT, refresh_token: 'rt-1' }])
    const t = await resolveMobyAccessToken()
    expect(t).toBe(FRESH_AT)
    expect(hasSessionCredentials()).toBe(true)
    const persisted = JSON.parse(readFileSync(process.env.MOBY_SESSION_PATH!, 'utf8'))
    expect(persisted.refreshToken).toBe('rt-1')
    expect(persisted.accessToken).toBe(FRESH_AT)
  })

  it('serves persisted valid token without network', async () => {
    process.env.MOBY_API_KEY = STALE_AT
    process.env.MOBY_REFRESH_TOKEN = 'rt-env'
    mockRefreshSequence([{}])
    await resolveMobyAccessToken() // rotate once → file written
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network should not be hit') }))
    resetMobySession() // forget memory; file has valid AT
    const t = await resolveMobyAccessToken()
    expect(t).toBe(FRESH_AT)
  })

  it('rotates from expired persisted AT without env', async () => {
    // Seed file with stale AT + RT (simulates server restart after ~1h).
    const stale = { accessToken: STALE_AT, accessTokenExp: 0, refreshToken: 'rt-file' }
    writeFileSync(process.env.MOBY_SESSION_PATH!, JSON.stringify(stale))
    resetMobySession()
    mockRefreshSequence([{ token: FRESH_AT, refresh_token: 'rt-2' }])
    const t = await resolveMobyAccessToken(true)
    expect(t).toBe(FRESH_AT)
    const persisted = JSON.parse(readFileSync(process.env.MOBY_SESSION_PATH!, 'utf8'))
    expect(persisted.refreshToken).toBe('rt-2')
  })

  it('surfaces refresh failure when RT exists instead of degrading silently', async () => {
    process.env.MOBY_API_KEY = STALE_AT
    process.env.MOBY_REFRESH_TOKEN = 'rt-env'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'x' }), { status: 401 })),
    )
    await expect(resolveMobyAccessToken()).rejects.toThrow('Privy session refresh failed')
  })

  it('falls back to static MOBY_API_KEY when no RT', async () => {
    process.env.MOBY_API_KEY = STALE_AT
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network expected') }))
    const t = await resolveMobyAccessToken()
    expect(t).toBe(STALE_AT)
  })
})
