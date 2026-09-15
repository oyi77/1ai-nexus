// Email-OTP self-heal tests (no network — fetch + GuerrillaMail mocked).

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  reauthenticateViaEmail,
  resetReauthState,
} from '../moby/reauth'
import {
  resolveMobyAccessToken,
  resetMobySession,
} from '../moby/session'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'moby-reauth-'))
  process.env.MOBY_SESSION_PATH = join(dir, 'session.json')
  delete process.env.MOBY_API_KEY
  delete process.env.MOBY_REFRESH_TOKEN
  delete process.env.MOBY_EMAIL
  resetMobySession()
  resetReauthState()
})

afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
})

const NEW_AT = 'new.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.b'
const STALE_AT = 'stale.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 99999 })).toString('base64url') + '.o'

function privyOk(body: object) {
  return new Response(JSON.stringify(body), { status: 200 })
}

describe('reauthenticateViaEmail', () => {
  it('throws for non-Guerrilla inboxes (no server-side reader)', async () => {
    await expect(reauthenticateViaEmail('me@gmail.com')).rejects.toThrow('not a GuerrillaMail address')
  })

  it('runs init → poll → authenticate and returns pair', async () => {
    let otpMailVisible = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, _init?: RequestInit) => {
        const u = String(url)
        if (u.includes('passwordless/init')) {
          otpMailVisible = true
          return privyOk({ success: true })
        }
        if (u.includes('set_email_user')) return privyOk({ sid_token: 's1', email_addr: 'x@guerrillamailblock.com' })
        if (u.includes('get_email_list')) {
          // Baseline (pre-init) empty; OTP mail appears afterwards.
          if (!otpMailVisible) return privyOk({ list: [] })
          return privyOk({ list: [{ mail_id: 2, mail_from: 'no-reply@privy.io' }] })
        }
        if (u.includes('fetch_email')) return privyOk({ mail_body: 'code 424242' })
        if (u.includes('passwordless/authenticate')) {
          const sent = JSON.parse((_init?.body as string) ?? '{}')
          expect(sent.code).toBe('424242')
          return privyOk({ token: NEW_AT, refresh_token: 'rt-new' })
        }
        return new Response('{}', { status: 404 })
      }),
    )
    const creds = await reauthenticateViaEmail('x@guerrillamailblock.com')
    expect(creds.token).toBe(NEW_AT)
    expect(creds.refreshToken).toBe('rt-new')
  }, 120_000)

  it('throws when no OTP mail arrives in time', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url)
        if (u.includes('passwordless/init')) return privyOk({ success: true })
        if (u.includes('set_email_user')) return privyOk({ sid_token: 's1' })
        if (u.includes('get_email_list')) return privyOk({ list: [] })
        return new Response('{}', { status: 404 })
      }),
    )
    await expect(reauthenticateViaEmail('x@guerrillamailblock.com')).rejects.toThrow('no Privy OTP mail')
  }, 120_000)
})

describe('resolveMobyAccessToken self-heal', () => {
  it('revoked RT (401) → email reauth → new session persisted', async () => {
    process.env.MOBY_EMAIL = 'heal@guerrillamailblock.com'
    let otpMailVisible = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, _init?: RequestInit) => {
        const u = String(url)
        // Refresh attempt: reject with 401 (burned RT).
        if (u.includes('auth.privy.io/api/v1/sessions')) {
          return new Response('{"error":"invalid"}', { status: 401 })
        }
        // Then the re-auth flow.
        if (u.includes('passwordless/init')) {
          otpMailVisible = true
          return privyOk({ success: true })
        }
        if (u.includes('set_email_user')) return privyOk({ sid_token: 's1' })
        if (u.includes('get_email_list')) {
          // Baseline (pre-init) empty; OTP mail appears afterwards.
          if (!otpMailVisible) return privyOk({ list: [] })
          return privyOk({ list: [{ mail_id: 2, mail_from: 'no-reply@privy.io' }] })
        }
        if (u.includes('fetch_email')) return privyOk({ mail_body: 'your code 918273' })
        if (u.includes('passwordless/authenticate')) return privyOk({ token: NEW_AT, refresh_token: 'rt-healed' })
        return new Response('{}', { status: 404 })
      }),
    )
    // Force start with a dead session file (no valid path).
    const { writeFileSync } = await import('node:fs')
    writeFileSync(process.env.MOBY_SESSION_PATH!, JSON.stringify({ accessToken: STALE_AT, accessTokenExp: 0, refreshToken: 'rt-dead' }))
    resetMobySession()
    const t = await resolveMobyAccessToken(true)
    expect(t).toBe(NEW_AT)
    const persisted = JSON.parse(readFileSync(process.env.MOBY_SESSION_PATH!, 'utf8'))
    expect(persisted.refreshToken).toBe('rt-healed')
  }, 120_000)

  it('no MOBY_EMAIL → fatal actionable error (no silent heal)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"invalid"}', { status: 401 })),
    )
    const { writeFileSync } = await import('node:fs')
    writeFileSync(process.env.MOBY_SESSION_PATH!, JSON.stringify({ accessToken: STALE_AT, accessTokenExp: 0, refreshToken: 'rt-dead' }))
    resetMobySession()
    await expect(resolveMobyAccessToken(true)).rejects.toThrow('session revoked')
    expect(existsSync(process.env.MOBY_SESSION_PATH!)).toBe(false)
  })
})
