// ─────────────────────────────────────────────────────────────
// Moby session state — Privy JWT auto-renew (dual-account).
//
// Privy access JWTs live ~1h; refresh tokens are long-lived and
// ROTATE on every refresh call (proven live 2026-09-15: 3
// consecutive rotations, POST auth.privy.io/api/v1/sessions
// {refresh_token} → 200 {token, privy_access_token, refresh_token}).
// The Authorization header may carry an EXPIRED access token —
// the refresh token is the only secret that matters.
//
// TWO ACCOUNTS (added 2026-10-02):
//   primary  — MOBY_API_KEY/MOBY_REFRESH_TOKEN/MOBY_EMAIL, file
//              data/moby-session.json (MOBY_SESSION_PATH overrides).
//   fallback — MOBY_FALLBACK_API_KEY/MOBY_FALLBACK_REFRESH_TOKEN/
//              MOBY_FALLBACK_EMAIL, file data/moby-session-fallback.json
//              (MOBY_FALLBACK_SESSION_PATH overrides). A second Privy
//              identity used only when the primary cannot produce a
//              token (revoked, negative-cached, unconfigured). Gives
//              rate-limit/quota headroom and outage isolation.
// Both accounts share the same store machinery via createMobyStore().
//
// Storage: JSON file (plaintext, chmod 0600 — same trust level as
// data/botx-keys.sqlite; gitignored). Per-account precedence:
// in-memory → file → refresh via RT → static API key fallback.
// <KEY> + <RT> (one Privy auth response) seed the store on first boot;
// after the first rotation the file's pair wins.
//
// Failure semantics (per account):
// - Privy session_update_action 'clear' or 401 on refresh (RT burned/
//   revoked) → clearSession() deletes the file, then SELF-HEALS via
//   <PREFIX>_EMAIL auto re-auth (email OTP → fresh identity + pair)
//   when configured; without it the account raises a fatal error.
// - A failed refresh sets a 10-min negative cache so a dead RT doesn't
//   hammer auth.privy.io on every meme request.
// - resolveMobyAccessToken: primary fails → fallback account tries
//   (if configured) → both fail = original primary error surfaces.
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, renameSync, mkdirSync, chmodSync, unlinkSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { logger } from '@/lib/logger'
import { reauthenticateViaEmail } from './reauth'

const PRIVY_APP_ID = 'cmg5m1dgg025kl20cusn1cypb'
// Refresh this many ms before real expiry to dodge clock skew +
// an in-flight request straddling the expiry boundary.
const EXPIRY_SLACK_MS = 5 * 60 * 1000
// After a failed refresh, suppress further Privy calls for this long —
// a dead RT gets one 401 per window instead of one per request.
const NEGATIVE_CACHE_MS = 10 * 60 * 1000

export interface MobySession {
  accessToken: string
  accessTokenExp: number // unix ms
  refreshToken: string
}

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

interface MobyStoreEnv {
  sessionPathEnv: string
  defaultPath: string
  apiKeyEnv: string
  rtEnv: string
  emailEnv: string
  label: string
}

interface MobyStoreState {
  env: MobyStoreEnv
  cached: MobySession | null
  refreshInflight: Promise<MobySession> | null
  refreshBlockedUntil: number
  rtPresenceCache: { until: number; value: boolean } | null
  lastHealAt: number
}

function createStore(env: MobyStoreEnv): MobyStoreState {
  return { env, cached: null, refreshInflight: null, refreshBlockedUntil: 0, rtPresenceCache: null, lastHealAt: 0 }
}

function sessionPath(st: MobyStoreState): string {
  return process.env[st.env.sessionPathEnv] ?? join(process.cwd(), st.env.defaultPath)
}

function readSessionFile(st: MobyStoreState): MobySession | null {
  try {
    const raw = JSON.parse(readFileSync(sessionPath(st), 'utf8')) as MobySession
    if (raw.accessToken && raw.refreshToken) return raw
    return null
  } catch {
    return null
  }
}

function writeSessionFile(st: MobyStoreState, s: MobySession): void {
  try {
    mkdirSync(dirname(sessionPath(st)), { recursive: true })
    const tmp = `${sessionPath(st)}.tmp`
    writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 })
    renameSync(tmp, sessionPath(st)) // atomic
    try {
      chmodSync(sessionPath(st), 0o600) // tighten pre-existing files too
    } catch { /* best-effort */ }
  } catch (e) {
    // Unwritable fs — in-memory cache serves until restart, but rotation
    // is then lost (env seeds take over). Make that loud.
    logger.warn(`moby ${st.env.label} session persist failed — next restart re-seeds from env`, 'moby', { err: String(e), path: sessionPath(st) })
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
    if (res.status === 401) throw new PrivyRevokedError(`HTTP 401 from ${res.url}`)
    throw new Error(`Privy session refresh failed: HTTP ${res.status}`)
  }
  const body = (await res.json()) as PrivySessionResponse
  if (body.session_update_action === 'clear') {
    throw new PrivyRevokedError('session_update_action=clear')
  }
  const accessTokenNew = body.token ?? ''
  const refreshTokenNew = body.refresh_token ?? refreshToken
  if (!accessTokenNew) throw new Error('Privy session refresh: no token in response')
  return { accessToken: accessTokenNew, accessTokenExp: jwtExpMs(accessTokenNew), refreshToken: refreshTokenNew }
}

/** Privy declared the session dead (401 / 'clear'). Carries the reason. */
class PrivyRevokedError extends Error {
  constructor(reason: string) {
    super(reason)
  }
}

/**
 * Privy declared the session dead (server-side revocation / RT exhausted).
 * Delete the stale file so restarts don't retry a burned RT, then
 * self-heal: <PREFIX>_EMAIL re-auth (email OTP → fresh pair) when
 * configured, else fatal actionable error.
 */
async function clearSession(st: MobyStoreState, reason: string): Promise<MobySession> {
  st.cached = null
  st.rtPresenceCache = null
  st.refreshBlockedUntil = 0
  try {
    if (existsSync(sessionPath(st))) unlinkSync(sessionPath(st))
  } catch { /* best-effort cleanup */ }
  const email = process.env[st.env.emailEnv]
  if (!email) {
    throw new Error(
      `Moby ${st.env.label} Privy session revoked (${reason}) — set ${st.env.emailEnv} ` +
        '(guerrillamail.com address auto-re-auths) or re-seed ' +
        `${st.env.apiKeyEnv} + ${st.env.rtEnv} manually.`,
    )
  }
  // Self-heal: fresh identity + pair, persisted as the new session.
  const creds = await reauthenticateViaEmail(email)
  const fresh: MobySession = {
    accessToken: creds.token,
    accessTokenExp: jwtExpMs(creds.token),
    refreshToken: creds.refreshToken,
  }
  st.cached = fresh
  writeSessionFile(st, fresh)
  st.lastHealAt = Date.now()
  logger.warn(`moby ${st.env.label} self-heal complete: session re-established for ${email}`, 'moby')
  // Fire-and-forget operator alert — a heal is notable (RT chain died).
  void notifyHeal(email, reason, st.env.label)
  return fresh
}

/**
 * Last successful primary email self-heal (unix ms, 0 = never since boot).
 * Surfaced via the leaderboard's moby platformStatus for at-a-glance
 * auth health.
 */
export function getMobyLastHealAt(): number {
  return primary.lastHealAt
}

/**
 * Operator notice for a heal — direct to TELEGRAM_ADMIN_CHAT_ID via the
 * bot API (repo convention, mirrors zero-issue-cron). registeredChats is
 * runtime-populated and empty on cold boot, so broadcastAlert would
 * silently no-op. Never throws, never blocks the heal.
 */
async function notifyHeal(email: string, reason: string, label: string): Promise<void> {
  try {
    // Proven pair (zero-issue-cron): hub bot token + hub owner chat.
    const token = process.env.HUB_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN
    const chatId = process.env.HUB_TELEGRAM_OWNER_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID
    if (!token || !chatId) return
    const t = new Date().toISOString().slice(11, 19)
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `🩹 Moby ${label} session self-healed at ${t} UTC\nreason: ${reason}\nidentity: ${email}`,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    const body = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null
    // Delivery receipt: ok:true = Telegram accepted the message for the chat.
    if (res.ok && body?.ok) logger.info(`moby ${label} heal alert delivered`, 'moby')
    else logger.warn(`moby ${label} heal alert FAILED: HTTP ${res.status} ${body?.description ?? ''}`, 'moby')
  } catch (e) {
    // Alerting is best-effort — never fail the heal itself.
    logger.warn(`moby ${label} heal alert error: ${String(e)}`, 'moby')
  }
}

/** Rotate once (single-flight, per account) and persist. `force` bypasses the negative cache (a live 401 is proof the token is dead). */
async function rotate(st: MobyStoreState, force = false): Promise<MobySession> {
  if (st.refreshInflight) return st.refreshInflight
  st.refreshInflight = (async () => {
    if (!force && Date.now() < st.refreshBlockedUntil) {
      throw new Error(`Moby ${st.env.label} refresh blocked (recent Privy failure — negative cache active)`)
    }
    const current = st.cached ?? readSessionFile(st)
    // AT: persisted (even expired — Privy accepts it), else env seed.
    // RT: persisted (authoritative — env RT goes stale after first rotation).
    const at = current?.accessToken ?? process.env[st.env.apiKeyEnv] ?? ''
    const rt = current?.refreshToken ?? process.env[st.env.rtEnv]
    if (!at || !rt) {
      const email = process.env[st.env.emailEnv]
      if (!email) {
        throw new Error(
          `No Moby ${st.env.label === 'primary' ? '' : `${st.env.label} `}session — set both ${st.env.apiKeyEnv} (any JWT from the ` +
            'session, expired ok) and ' + st.env.rtEnv + ' (long-lived) from ONE Privy auth ' +
            `response, or set ${st.env.emailEnv} (guerrillamail.com address) to auto-bootstrap ` +
            'via email OTP; the module then self-renews and persists the session file.',
        )
      }
      // Cold boot with only <PREFIX>_EMAIL: bootstrap the session.
      const creds = await reauthenticateViaEmail(email)
      const healed: MobySession = { accessToken: creds.token, accessTokenExp: jwtExpMs(creds.token), refreshToken: creds.refreshToken }
      st.refreshBlockedUntil = 0
      st.cached = healed
      writeSessionFile(st, healed)
      logger.info(`moby ${st.env.label} session bootstrapped via email self-heal (${email})`, 'moby')
      return healed
    }
    let fresh: MobySession
    try {
      fresh = await refreshPrivySession(at, rt)
    } catch (e) {
      if (e instanceof PrivyRevokedError) {
        // clearSession self-heals when email is configured (fresh pair
        // lands in cache + file) or throws its own fatal error.
        fresh = await clearSession(st, e.message)
      } else {
        // One failure per NEGATIVE_CACHE_MS — a dead RT must not be
        // re-probed on every meme request. (Self-heal failures also
        // land here: don't OTP-spam Privy every request either.)
        st.refreshBlockedUntil = Date.now() + NEGATIVE_CACHE_MS
        throw e
      }
    }
    st.refreshBlockedUntil = 0
    st.cached = fresh
    writeSessionFile(st, fresh)
    return fresh
  })()
  try {
    return await st.refreshInflight
  } finally {
    st.refreshInflight = null
  }
}

/** Resolve one account's token: memory → file → refresh → static key. */
async function resolveStore(st: MobyStoreState, force = false): Promise<string> {
  if (!force) {
    const now = Date.now() + EXPIRY_SLACK_MS
    if (st.cached?.accessTokenExp && st.cached.accessTokenExp > now) return st.cached.accessToken
    const fromFile = readSessionFile(st)
    if (fromFile) {
      const exp = jwtExpMs(fromFile.accessToken)
      if (exp > now) {
        st.cached = { ...fromFile, accessTokenExp: exp }
        return st.cached.accessToken
      }
    }
  }
  try {
    const fresh = await rotate(st, force)
    return fresh.accessToken
  } catch (e) {
    // Static-key fallback only when NO refresh path exists (no env RT and
    // no file RT). If refresh was attempted and refused, surface the real
    // error — silently degrading to a dying static JWT hides the problem.
    const hasRt =
      !!process.env[st.env.rtEnv] ||
      !!st.cached?.refreshToken ||
      !!readSessionFile(st)?.refreshToken
    if (!hasRt) {
      const fallback = process.env[st.env.apiKeyEnv]
      if (fallback) return fallback
    }
    throw e
  }
}

// ── Account wiring ───────────────────────────────────────────
const primary = createStore({
  sessionPathEnv: 'MOBY_SESSION_PATH',
  defaultPath: join('data', 'moby-session.json'),
  apiKeyEnv: 'MOBY_API_KEY',
  rtEnv: 'MOBY_REFRESH_TOKEN',
  emailEnv: 'MOBY_EMAIL',
  label: 'primary',
})

const fallbackStore = createStore({
  sessionPathEnv: 'MOBY_FALLBACK_SESSION_PATH',
  defaultPath: join('data', 'moby-session-fallback.json'),
  apiKeyEnv: 'MOBY_FALLBACK_API_KEY',
  rtEnv: 'MOBY_FALLBACK_REFRESH_TOKEN',
  emailEnv: 'MOBY_FALLBACK_EMAIL',
  label: 'fallback',
})

/** True when any fallback-account credential is configured. */
export function hasMobyFallbackCredentials(): boolean {
  return (
    !!process.env.MOBY_FALLBACK_API_KEY ||
    !!process.env.MOBY_FALLBACK_REFRESH_TOKEN ||
    !!process.env.MOBY_FALLBACK_EMAIL ||
    !!readSessionFile(fallbackStore)
  )
}

/**
 * Resolve a usable Moby access token.
 * Primary account first (memory → file → refresh → env); if the primary
 * cannot produce a token and a fallback identity is configured, the
 * fallback account is tried before surfacing the primary's error.
 * `force` (after a 401) skips straight to rotation on both.
 */
export async function resolveMobyAccessToken(force = false): Promise<string> {
  let primaryError: unknown
  try {
    return await resolveStore(primary, force)
  } catch (e) {
    primaryError = e
  }
  if (hasMobyFallbackCredentials()) {
    try {
      return await resolveStore(fallbackStore, force)
    } catch (fb) {
      logger.warn(`moby fallback account also failed: ${fb instanceof Error ? fb.message : String(fb)}`, 'moby')
    }
  }
  throw primaryError
}

let rtPresenceCache: { until: number; value: boolean } | null = null

/** True when an RT exists anywhere (primary memory/file/env) — gates session-first auth. */
export function hasSessionCredentials(): boolean {
  if (primary.cached?.refreshToken) return true
  if (rtPresenceCache && Date.now() < rtPresenceCache.until) return rtPresenceCache.value
  try {
    const f = readSessionFile(primary)
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

/** Test/diag helper: forget in-memory state (both accounts). */
export function resetMobySession(): void {
  for (const st of [primary, fallbackStore]) {
    st.cached = null
    st.refreshInflight = null
    st.rtPresenceCache = null
    st.refreshBlockedUntil = 0
  }
  rtPresenceCache = null
}
