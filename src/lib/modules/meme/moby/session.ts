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
// Storage: data/moby-session.json (plaintext, chmod 0600 — same trust
// level as data/botx-keys.sqlite; gitignored). Precedence: in-memory →
// file → refresh via RT → env MOBY_API_KEY static fallback.
// MOBY_API_KEY + MOBY_REFRESH_TOKEN (one Privy auth response) seed the
// store on first boot; after the first rotation the file's pair wins.
//
// Failure semantics:
// - Privy session_update_action 'clear' or 401 on refresh (RT burned/
//   revoked) → clearSession() deletes the file, then SELF-HEALS via
//   MOBY_EMAIL auto re-auth (email OTP → fresh identity + pair) when
//   configured; without MOBY_EMAIL it raises a fatal actionable error.
// - A failed refresh sets a 10-min negative cache so a dead RT doesn't
//   hammer auth.privy.io on every meme request.
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, renameSync, mkdirSync, chmodSync, unlinkSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { logger } from '@/lib/logger'
import { reauthenticateViaEmail } from './reauth'

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
// After a failed refresh, suppress further Privy calls for this long —
// a dead RT gets one 401 per window instead of one per request.
const NEGATIVE_CACHE_MS = 10 * 60 * 1000
let refreshBlockedUntil = 0

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
    writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 })
    renameSync(tmp, sessionPath()) // atomic
    try {
      chmodSync(sessionPath(), 0o600) // tighten pre-existing files too
    } catch { /* best-effort */ }
  } catch (e) {
    // Unwritable fs — in-memory cache serves until restart, but rotation
    // is then lost (env seeds take over). Make that loud.
    logger.warn('moby session persist failed — next restart re-seeds from env', 'moby', { err: String(e), path: sessionPath() })
  }
}

interface PrivySessionResponse {
  token?: string
  refresh_token?: string
  session_update_action?: string // 'set' | 'clear' | 'ignore'
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
    // 401 with a real-shaped AT + RT = Privy no longer recognizes the
    // session (RT burned/revoked). Retry never heals — clear + self-heal
    // or fatal.
    if (res.status === 401) await clearSession(`HTTP 401 from ${res.url}`)
    throw new Error(`Privy session refresh failed: HTTP ${res.status}`)
  }
  const body = (await res.json()) as PrivySessionResponse
  if (body.session_update_action === 'clear') {
    await clearSession('session_update_action=clear')
  }
  const accessTokenNew = body.token ?? ''
  const refreshTokenNew = body.refresh_token ?? refreshToken
  if (!accessTokenNew) throw new Error('Privy session refresh: no token in response')
  return { accessToken: accessTokenNew, accessTokenExp: jwtExpMs(accessTokenNew), refreshToken: refreshTokenNew }
}

/**
 * Privy declared the session dead ('clear' = server-side revocation /
 * RT exhausted). Delete the stale file so restarts don't retry a burned
 * RT, then self-heal: MOBY_EMAIL re-auth (email OTP → fresh pair) when
 * configured, else fatal actionable error.
 */
async function clearSession(reason: string): Promise<never> {
  cached = null
  rtPresenceCache = null
  refreshBlockedUntil = 0
  try {
    if (existsSync(sessionPath())) unlinkSync(sessionPath())
  } catch { /* best-effort cleanup */ }
  const email = process.env.MOBY_EMAIL
  if (!email) {
    throw new Error(
      `Moby Privy session revoked (${reason}) — set MOBY_EMAIL (guerrillamail.com address ` +
        'auto-re-auths) or re-seed MOBY_API_KEY + MOBY_REFRESH_TOKEN manually.',
    )
  }
  // Self-heal: fresh identity + pair, persisted as the new session.
  const creds = await reauthenticateViaEmail(email)
  const fresh: MobySession = {
    accessToken: creds.token,
    accessTokenExp: jwtExpMs(creds.token),
    refreshToken: creds.refreshToken,
  }
  cached = fresh
  writeSessionFile(fresh)
  logger.warn(`moby self-heal complete: session re-established for ${email}`, 'moby')
  // Never returns normally — callers already hold a thrown error; we
  // rethrow a sentinel the resolver converts into a successful retry.
  throw new SessionReauthSucceeded()
}

/** Internal control-flow sentinel: session was re-established mid-failure. */
class SessionReauthSucceeded extends Error {
  constructor() {
    super('moby session re-established via email self-heal')
  }
}

/** Rotate once (single-flight) and persist. `force` bypasses the negative cache (a live 401 is proof the token is dead). */
async function rotate(force = false): Promise<MobySession> {
  if (refreshInflight) return refreshInflight
  refreshInflight = (async () => {
    if (!force && Date.now() < refreshBlockedUntil) {
      throw new Error('Moby refresh blocked (recent Privy failure — negative cache active)')
    }
    const current = cached ?? readSessionFile()
    // AT: persisted (even expired — Privy accepts it), else env seed.
    // RT: persisted (authoritative — env RT goes stale after first rotation).
    const at = current?.accessToken ?? process.env.MOBY_API_KEY ?? ''
    const rt = current?.refreshToken ?? process.env.MOBY_REFRESH_TOKEN
    if (!at || !rt) {
      const email = process.env.MOBY_EMAIL
      if (!email) {
        throw new Error(
          'No Moby session — set both MOBY_API_KEY (any JWT from the session, expired ok) ' +
            'and MOBY_REFRESH_TOKEN (long-lived) from ONE Privy auth response, or set ' +
            'MOBY_EMAIL (guerrillamail.com address) to auto-bootstrap via email OTP; ' +
            'the module then self-renews and persists data/moby-session.json.',
        )
      }
      // Cold boot with only MOBY_EMAIL: bootstrap the session.
      const creds = await reauthenticateViaEmail(email)
      const healed: MobySession = { accessToken: creds.token, accessTokenExp: jwtExpMs(creds.token), refreshToken: creds.refreshToken }
      refreshBlockedUntil = 0
      cached = healed
      writeSessionFile(healed)
      logger.info(`moby session bootstrapped via email self-heal (${email})`, 'moby')
      return healed
    }
    let fresh: MobySession
    try {
      fresh = await refreshPrivySession(at, rt)
    } catch (e) {
      if (e instanceof SessionReauthSucceeded) {
        // clearSession self-healed (fresh pair already in cache + file).
        // Recursion is safe: cached now valid, next line returns it.
        fresh = cached!
      } else {
        // One failure per NEGATIVE_CACHE_MS — a dead RT must not be
        // re-probed on every meme request. (Self-heal failures also
        // land here: don't OTP-spam Privy every request either.)
        refreshBlockedUntil = Date.now() + NEGATIVE_CACHE_MS
        throw e
      }
    }
    refreshBlockedUntil = 0
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
    const fresh = await rotate(force)
    return fresh.accessToken
  } catch (e) {
    // Static MOBY_API_KEY fallback only when NO refresh path exists
    // (no env RT and no file RT). If a refresh was *attempted* and
    // refused, surface the real error — silently degrading to a dying
    // static JWT hides the session problem.
    const hasRt =
      !!process.env.MOBY_REFRESH_TOKEN ||
      !!cached?.refreshToken ||
      !!readSessionFile()?.refreshToken
    if (!hasRt) {
      const fallback = process.env.MOBY_API_KEY
      if (fallback) return fallback
    }
    throw e
  }
}

let rtPresenceCache: { until: number; value: boolean } | null = null

/** True when an RT exists anywhere (memory/file/env) — gates session-first auth. */
export function hasSessionCredentials(): boolean {
  if (cached?.refreshToken) return true
  if (rtPresenceCache && Date.now() < rtPresenceCache.until) return rtPresenceCache.value
  try {
    const f = readSessionFile()
    if (f?.refreshToken) {
      rtPresenceCache = { until: Date.now() + 30_000, value: true }
      return true
    }
  } catch {
    // fall through
  }
  const v = !!process.env.MOBY_REFRESH_TOKEN
  rtPresenceCache = { until: Date.now() + 30_000, value: v }
  return v
}

/** Test/diag helper: forget in-memory state. */
export function resetMobySession(): void {
  cached = null
  refreshInflight = null
  rtPresenceCache = null
  refreshBlockedUntil = 0
}
