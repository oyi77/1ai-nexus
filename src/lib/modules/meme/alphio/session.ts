// ─────────────────────────────────────────────────────────────
// Alphio authed session — server-side Bearer for the member-only
// api.alphio.ai crypto/meme/* family (trending/new-tokens/search/
// token/kline/holders/token-trades — all GET keyless-proofed live
// 2026-10-09, ret:0 with Authorization header).
//
// Auth chain (RE 2026-10-09 from app.alphio.ai Vite bundle):
//   - api.alphio.ai has NO /refresh-token route (exhaustive probe:
//     14 path+method combos 404; /v2/user/login wants identifier+
//     password; /v2/user/social/login wants Privy id_token; Privy
//     auth.privy.io/api/v1/sessions is DPoP key-bound server-side:
//     401 invalid_token even with valid privy_token).
//   - So: NO server-side refresh possible. The operator-supplied
//     access token (45d TTL, agent-web-auth-access-token) is the
//     durable credential; RT is stored for a future browser-assisted
//     rotation, not used here.
// Storage: data/alphio-session.json (plaintext, chmod 0600 — same
// trust as data/moby-session.json; gitignored). Precedence:
// env ALPHIO_API_KEY (raw AT) > file > null (module disabled).
// DB-primary (2026-10-15): writes mirror to SessionToken; reads
// try DB first via loadAlphioSessionAsync.
// ─────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { logger } from '@/lib/logger'
import { loadSessionToken, mirrorSessionTokenSync } from '@/lib/modules/derived/db-session-store'

export interface AlphioSessionShape {
  accessToken: string
  accessTokenExp: number // unix ms
  refreshToken?: string
  refreshTokenExp?: number // unix ms
}

const CONTEXT = 'meme:alphio.session'
const DEFAULT_PATH = join(process.cwd(), 'data', 'alphio-session.json')

export function alphioSessionPath(): string {
  return process.env.ALPHIO_SESSION_PATH || DEFAULT_PATH
}

export function jwtExpMs(token: string): number {
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

let cached: AlphioSessionShape | null | undefined

export function __resetAlphioSessionForTests(): void {
  cached = undefined
}

function readSessionFile(): AlphioSessionShape | null {
  const path = alphioSessionPath()
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<AlphioSessionShape>
    if (!raw.accessToken) return null
    return {
      accessToken: raw.accessToken,
      accessTokenExp: raw.accessTokenExp ?? jwtExpMs(raw.accessToken),
      refreshToken: raw.refreshToken,
      refreshTokenExp: raw.refreshTokenExp,
    }
  } catch (err) {
    logger.warn(CONTEXT, `session file unreadable: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/**
 * Async loader: DB first, JSON fallback. Public signatures of the
 * sync resolve path are unchanged; this is used when callers can await.
 * Never throws — returns null when neither layer has data.
 */
export async function loadAlphioSessionAsync(): Promise<AlphioSessionShape | null> {
  try {
    const db = await loadSessionToken<AlphioSessionShape>('alphio')
    if (db?.accessToken) return db
  } catch {
    /* fall through to sync JSON */
  }
  return readSessionFile()
}

export function writeAlphioSession(s: AlphioSessionShape): void {
  const path = alphioSessionPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(s, null, 2))
  try {
    chmodSync(path, 0o600)
  } catch {
    /* best effort */
  }
  cached = s
  // DB mirror (DB-primary, 2026-10-15): fire-and-forget upsert so the
  // SessionToken row stays fresh alongside the JSON backup. Never throws.
  const expMs = s.accessTokenExp > 0 ? s.accessTokenExp : (s.refreshTokenExp ?? 0)
  mirrorSessionTokenSync('alphio', s, expMs > 0 ? new Date(expMs) : null)
}

/** Raw access token or null when unconfigured/expired. No network calls. */
export function resolveAlphioAccessToken(): string | null {
  if (cached === undefined) {
    const env = process.env.ALPHIO_API_KEY?.trim()
    cached = env
      ? { accessToken: env, accessTokenExp: jwtExpMs(env) }
      : readSessionFile()
  }
  if (!cached) return null
  if (cached.accessTokenExp > 0 && Date.now() > cached.accessTokenExp) {
    logger.warn(CONTEXT, 'access token expired; operator must restage data/alphio-session.json')
    return null
  }
  return cached.accessToken
}

export function hasAlphioCredentials(): boolean {
  return !!process.env.ALPHIO_API_KEY || existsSync(alphioSessionPath())
}
