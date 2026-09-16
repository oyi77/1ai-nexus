// ─────────────────────────────────────────────────────────────
// Stockbit session store — exodus JWT auto-renew via refresh token.
//
// Access JWTs live ~24h; refresh tokens ROTATE on every refresh
// call (each /login/refresh mints a new RT and retires the one
// presented — single writer only: the harvester cron).
// Live-verified 2026-09-16 (auth RE verdict local/stockbit-auth-re.md).
//
// Storage: data/stockbit-session.json (plaintext, chmod 0600 — same
// trust level as data/moby-session.json; gitignored). Precedence:
// in-memory → file → refresh via RT → env seed pair.
// STOCKBIT_ACCESS_TOKEN + STOCKBIT_REFRESH_TOKEN seed the store on
// first boot; after the first rotation the file's pair wins.
//
// Failure semantics (NO email self-heal exists for Stockbit —
// re-auth needs interactive login):
// - 401 on refresh (RT burned/rotated elsewhere) → actionable fatal
//   error telling the operator to re-stage a fresh refresh token.
// - A failed refresh sets a 10-min negative cache so a dead RT
//   doesn't hammer exodus on every request.
//
// NEVER touched: POST /login/refresh more than needed, carina chain
// (needs trading PIN), any write endpoint.
// SERVER-ONLY.
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, renameSync, mkdirSync, chmodSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

const EXODUS = 'https://exodus.stockbit.com'

// Lazily resolved so tests can override per-test (a module-level
// const would freeze before env mutation).
function sessionPath(): string {
  return process.env.STOCKBIT_SESSION_PATH ?? join(process.cwd(), 'data', 'stockbit-session.json')
}
// Refresh this far before real expiry to dodge clock skew + an
// in-flight request straddling the expiry boundary.
const EXPIRY_SLACK_MS = 5 * 60 * 1000

interface StockbitSession {
  accessToken: string
  accessTokenExp: number // unix ms, 0 = unknown
  refreshToken: string
}

let cached: StockbitSession | null = null
let refreshInflight: Promise<StockbitSession> | null = null
// After a failed refresh, suppress further exodus calls for this long.
const NEGATIVE_CACHE_MS = 10 * 60 * 1000
let refreshBlockedUntil = 0

const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/

/** Redact JWT-shaped strings from anything destined for logs/errors. */
export function redactJwt(s: string): string {
  return s.replace(new RegExp(JWT_RE.source, 'g'), 'JWT<redacted>')
}

function jwtExpMs(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as {
      exp?: number
    }
    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0
  } catch {
    return 0
  }
}

function readSessionFile(): StockbitSession | null {
  try {
    if (!existsSync(sessionPath())) return null
    const raw = JSON.parse(readFileSync(sessionPath(), 'utf8')) as Partial<StockbitSession>
    if (typeof raw.accessToken !== 'string' || typeof raw.refreshToken !== 'string') return null
    return {
      accessToken: raw.accessToken,
      accessTokenExp: typeof raw.accessTokenExp === 'number' ? raw.accessTokenExp : jwtExpMs(raw.accessToken),
      refreshToken: raw.refreshToken,
    }
  } catch {
    return null
  }
}

function writeSessionFile(s: StockbitSession): void {
  mkdirSync(dirname(sessionPath()), { recursive: true })
  const tmp = `${sessionPath()}.tmp`
  writeFileSync(tmp, JSON.stringify(s))
  chmodSync(tmp, 0o600)
  renameSync(tmp, sessionPath())
}

/** Structurally locate fresh tokens in the nested refresh envelope. */
function extractPair(payload: unknown): { accessToken: string; refreshToken: string } | null {
  let access: string | null = null
  let refresh: string | null = null
  const walk = (o: unknown): void => {
    if (access && refresh) return
    if (typeof o === 'string') return
    if (Array.isArray(o)) {
      for (const v of o) walk(v)
      return
    }
    if (typeof o === 'object' && o !== null) {
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'string' && JWT_RE.test(v)) {
          const kl = k.toLowerCase()
          if (!access && kl.includes('access')) access = v
          else if (!refresh && kl.includes('refresh')) refresh = v
          else if (!access) access = v
        } else walk(v)
      }
    }
  }
  walk(payload)
  // Fallback: envelope nested {data:{data:{...}}} with exactly 2 JWTs — first = access.
  if (!refresh) {
    const found: string[] = []
    const collect = (o: unknown): void => {
      if (typeof o === 'string') {
        if (JWT_RE.test(o)) found.push(o)
        return
      }
      if (Array.isArray(o)) {
        for (const v of o) collect(v)
        return
      }
      if (typeof o === 'object' && o !== null) {
        for (const v of Object.values(o)) collect(v)
      }
    }
    collect(payload)
    if (found.length >= 2) {
      access = access ?? found[0]
      refresh = found[1]
    }
  }
  return access && refresh ? { accessToken: access, refreshToken: refresh } : null
}

/**
 * Exchange RT for a fresh pair at exodus. Empty body, bearer RT header
 * (matches Stockbit's own web client — verified in RE doc §1).
 */
export async function refreshStockbitSession(refreshToken: string): Promise<StockbitSession> {
  const res = await fetch(`${EXODUS}/login/refresh`, {
    method: 'POST',
    signal: AbortSignal.timeout(20_000),
    headers: { authorization: `Bearer ${refreshToken}`, accept: 'application/json' },
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Stockbit refresh HTTP ${res.status}: ${redactJwt(text).slice(0, 200)}`)
  }
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('Stockbit refresh: non-JSON response')
  }
  const pair = extractPair(payload)
  if (!pair) throw new Error('Stockbit refresh: no token pair in response envelope')
  return {
    accessToken: pair.accessToken,
    accessTokenExp: jwtExpMs(pair.accessToken),
    refreshToken: pair.refreshToken,
  }
}

/** Rotate once (single-flight) and persist. `force` bypasses the negative cache. */
async function rotate(force = false): Promise<StockbitSession> {
  if (!force && Date.now() < refreshBlockedUntil) {
    throw new Error('Stockbit refresh suppressed (recent failure — 10min negative cache)')
  }
  if (refreshInflight) return refreshInflight
  refreshInflight = (async () => {
    const current = cached ?? readSessionFile()
    const rt =
      current?.refreshToken ?? process.env.STOCKBIT_REFRESH_TOKEN ?? ''
    if (!rt) {
      throw new Error(
        'No Stockbit session: stage a refresh token via STOCKBIT_REFRESH_TOKEN env (or data/stockbit-session.json) — see local/stockbit-auth-re.md §14',
      )
    }
    try {
      const fresh = await refreshStockbitSession(rt)
      cached = fresh
      writeSessionFile(fresh)
      return fresh
    } catch (err) {
      refreshBlockedUntil = Date.now() + NEGATIVE_CACHE_MS
      const msg = err instanceof Error ? err.message : String(err)
      // RT burned (rotated elsewhere) or revoked — operator must re-stage.
      throw new Error(
        `Stockbit refresh failed — re-stage a fresh refresh token (the old one rotated or died). Cause: ${redactJwt(msg)}`,
      )
    } finally {
      refreshInflight = null
    }
  })()
  return refreshInflight
}

/**
 * Resolve a usable Stockbit access token: memory → file → refresh → env seed.
 * `force` (after a 401) skips straight to rotation.
 * NOTE: exp 0 (unparseable payload) is UNTRUSTED — falls through to
 * rotation, never returned. (`!exp → return` would serve stale tokens.)
 */
export async function resolveStockbitAccessToken(force = false): Promise<string> {
  if (!force && cached && cached.accessTokenExp - EXPIRY_SLACK_MS > Date.now()) {
    return cached.accessToken
  }
  if (!force) {
    const file = readSessionFile()
    if (file) {
      cached = file
      if (file.accessTokenExp - EXPIRY_SLACK_MS > Date.now()) {
        return file.accessToken
      }
    } else if (process.env.STOCKBIT_ACCESS_TOKEN && process.env.STOCKBIT_REFRESH_TOKEN) {
      cached = {
        accessToken: process.env.STOCKBIT_ACCESS_TOKEN,
        accessTokenExp: jwtExpMs(process.env.STOCKBIT_ACCESS_TOKEN),
        refreshToken: process.env.STOCKBIT_REFRESH_TOKEN,
      }
      if (cached.accessTokenExp - EXPIRY_SLACK_MS > Date.now()) {
        return cached.accessToken
      }
    }
  }
  return (await rotate(force)).accessToken
}

/** True when a refresh token exists anywhere (memory/file/env) — gates auth-first flows. */
export function hasSessionCredentials(): boolean {
  if (cached?.refreshToken) return true
  if (readSessionFile()?.refreshToken) return true
  return Boolean(process.env.STOCKBIT_REFRESH_TOKEN)
}

/** Test/diag helper: forget in-memory state. */
export function resetStockbitSession(): void {
  cached = null
  refreshInflight = null
  refreshBlockedUntil = 0
}
