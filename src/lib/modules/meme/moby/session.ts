// ─────────────────────────────────────────────────────────────
// Moby session state — Privy JWT auto-renew.
//
// Privy access JWTs live ~1h; refresh tokens are long-lived and
// ROTATE on every refresh call (proven live 2026-09-15: 3
// consecutive rotations, POST auth.privy.io/api/v1/sessions
// {refresh_token} → 200 {token, privy_access_token, refresh_token}).
// The Authorization header may carry an EXPIRED access token —
// the refresh token is the only secret that matters.
//
// Storage: data/moby-session.json (plaintext — same trust level as
// data/botx-keys.sqlite; gitignored). Precedence: in-memory →
// file → refresh via RT → env MOBY_API_KEY static fallback.
// MOBY_REFRESH_TOKEN env seeds the store on first boot; after the
// first rotation the file's RT wins (env RT is stale).
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

const PRIVY_APP_ID = 'cmg5m1dgg025kl20cusn1cypb'
// Lazily resolved so tests can override MOBY_SESSION_PATH per-test
// (a module-level const would freeze before env mutation).
function sessionPath(): string {
  return process.env.MOBY_SESSION_PATH ?? join(process.cwd(), 'data', 'moby-session.json')
}
// Refresh this many ms before real expiry to dodge clock skew +
// an in-flight request straddling the expiry boundary.
const EXPIRY_SLACK_MS = 5 * 60 * 1000

interface MobySession {
  accessToken: string
  accessTokenExp: number // unix ms
  refreshToken: string
}

let cached: MobySession | null = null
let refreshInflight: Promise<MobySession> | null = null

function jwtExpMs(token: string): number {
  const parts = token.split('.')
  if (parts.length !== 3) return 0
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      exp?: number
    }
    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0
  } catch {
    return 0
  }
}

function readSessionFile(): MobySession | null {
  try {
    const raw = JSON.parse(readFileSync(sessionPath(), 'utf8')) as MobySession
    if (raw.accessToken && raw.refreshToken) return raw
    return null
  } catch {
    return null
  }
}

function writeSessionFile(s: MobySession): void {
  try {
    mkdirSync(dirname(sessionPath()), { recursive: true })
    const tmp = `${sessionPath()}.tmp`
    writeFileSync(tmp, JSON.stringify(s))
    renameSync(tmp, sessionPath()) // atomic
  } catch {
    // Unwritable fs — in-memory cache still serves until process restart.
  }
}

interface PrivySessionResponse {
  token?: string
  refresh_token?: string
}

/**
 * Exchange RT for a fresh token pair at auth.privy.io.
 * Privy requires the Authorization header to carry a REAL (possibly long-
 * expired) access JWT from the same session — garbage/fake JWTs 401,
 * expired real ones 200 (verified 2026-09-15).
 */
export async function refreshPrivySession(
  accessToken: string,
  refreshToken: string,
): Promise<MobySession> {
  const res = await fetch('https://auth.privy.io/api/v1/sessions', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'privy-app-id': PRIVY_APP_ID,
      'privy-client': 'react-auth:2.15.0',
      origin: 'https://app.moby.win',
      referer: 'https://app.moby.win/',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36',
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    throw new Error(`Privy session refresh failed: HTTP ${res.status}`)
  }
  const body = (await res.json()) as PrivySessionResponse
  const accessTokenNew = body.token ?? ''
  const refreshTokenNew = body.refresh_token ?? refreshToken
  if (!accessTokenNew) throw new Error('Privy session refresh: no token in response')
  return { accessToken: accessTokenNew, accessTokenExp: jwtExpMs(accessTokenNew), refreshToken: refreshTokenNew }
}

/** Rotate once (single-flight) and persist. */
async function rotate(): Promise<MobySession> {
  if (refreshInflight) return refreshInflight
  refreshInflight = (async () => {
    const current = cached ?? readSessionFile()
    // AT: persisted (even expired — Privy accepts it), else env seed.
    // RT: persisted (authoritative — env RT goes stale after first rotation).
    const at = current?.accessToken ?? process.env.MOBY_API_KEY ?? ''
    const rt = current?.refreshToken ?? process.env.MOBY_REFRESH_TOKEN
    if (!at || !rt) {
      throw new Error(
        'No Moby session — set both MOBY_API_KEY (any JWT from the session, expired ok) ' +
          'and MOBY_REFRESH_TOKEN (long-lived) from ONE Privy auth response; the module ' +
          'then self-renews and persists data/moby-session.json.',
      )
    }
    const fresh = await refreshPrivySession(at, rt)
    cached = fresh
    writeSessionFile(fresh)
    return fresh
  })()
  try {
    return await refreshInflight
  } finally {
    refreshInflight = null
  }
}

/**
 * Resolve a usable Moby access token: memory → file → refresh → env.
 * `force` (after a 401) skips straight to rotation.
 */
export async function resolveMobyAccessToken(force = false): Promise<string> {
  if (!force) {
    const now = Date.now() + EXPIRY_SLACK_MS
    if (cached?.accessTokenExp && cached.accessTokenExp > now) return cached.accessToken
    const fromFile = readSessionFile()
    if (fromFile) {
      const exp = jwtExpMs(fromFile.accessToken)
      if (exp > now) {
        cached = { ...fromFile, accessTokenExp: exp }
        return cached.accessToken
      }
    }
  }
  try {
    const fresh = await rotate()
    return fresh.accessToken
  } catch (e) {
    // Static MOBY_API_KEY fallback only when rotation is impossible
    // (no RT configured). If RT exists but Privy refused, surface the
    // real error — silently degrading to a dying static JWT hides it.
    if (!process.env.MOBY_REFRESH_TOKEN && !readSessionFile()) {
      const fallback = process.env.MOBY_API_KEY
      if (fallback) return fallback
    }
    throw e
  }
}

/** True when an RT exists anywhere (memory/file/env) — gates session-first auth. */
export function hasSessionCredentials(): boolean {
  if (cached?.refreshToken) return true
  try {
    const f = readSessionFile()
    if (f?.refreshToken) return true
  } catch {
    // fall through
  }
  return !!process.env.MOBY_REFRESH_TOKEN
}

/** Test/diag helper: forget in-memory state. */
export function resetMobySession(): void {
  cached = null
  refreshInflight = null
}
