/**
 * Self-heal root of trust: Privy email-OTP re-auth.
 *
 * When the refresh-token chain dies (RT burned/revoked), a configured
 * MOBY_EMAIL re-establishes a session automatically:
 *   GuerrillaMail (persistent address) → passwordless/init → poll inbox
 *   for the no-reply@privy.io 6-digit code → passwordless/authenticate
 *   → {token, refresh_token} → session store re-seeded.
 *
 * Flow shape live-probed 2026-09-15 (auth.privy.io passwordless init/auth,
 * GuerrillaMail ajax API). Privy issues a NEW user id per fresh GuerrillaMail
 * address — for a stable identity use a permanent inbox you own and set
 * MOBY_EMAIL to it (same flow; address never expires).
 */

import { logger } from '@/lib/logger'

const PRIVY_APP_ID = 'cmg5m1dgg025kl20cusn1cypb'
const GM_API = 'https://api.guerrillamail.com/ajax.php'

export interface ReauthCredentials {
  token: string
  refreshToken: string
}

function privyHeaders(): Record<string, string> {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    'privy-app-id': PRIVY_APP_ID,
    'privy-client': 'react-auth:2.15.0',
    origin: 'https://app.moby.win',
    referer: 'https://app.moby.win/',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36',
  }
}

// ── GuerrillaMail inbox ─────────────────────────────────────

let gmSession: { sid: string; address: string } | null = null

async function gmSetUser(address: string): Promise<string> {
  const user = address.split('@')[0]
  const url = `${GM_API}?f=set_email_user&email_user=${encodeURIComponent(user)}&lang=en`
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`GuerrillaMail set_email_user failed: HTTP ${res.status}`)
  const body = (await res.json()) as { sid_token?: string; email_addr?: string; auth?: { success?: boolean } }
  if (!body.sid_token) throw new Error('GuerrillaMail: no sid_token in response')
  gmSession = { sid: body.sid_token, address: body.email_addr ?? address }
  return gmSession.sid
}

/** Highest privy.io mail_id currently in the inbox (pre-OTP baseline). */
async function gmBaselineMaxPrivyMailId(sid: string): Promise<number> {
  try {
    const res = await fetch(`${GM_API}?f=get_email_list&sid_token=${sid}&offset=0`, {
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return 0
    const body = (await res.json()) as {
      list?: Array<{ mail_id: number; mail_from: string }>
    }
    const ids = (body.list ?? [])
      .filter((m) => (m.mail_from ?? '').includes('privy.io'))
      .map((m) => m.mail_id)
    return ids.length > 0 ? Math.max(...ids) : 0
  } catch {
    return 0
  }
}

/** Poll the inbox until a no-reply@privy.io mail NEWER than sinceMailId arrives (max ~75s). */
async function gmFetchPrivyMail(sid: string, sinceMailId: number): Promise<string> {
  const deadline = Date.now() + 75_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000))
    const res = await fetch(`${GM_API}?f=get_email_list&sid_token=${sid}&offset=0`, {
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) continue
    const body = (await res.json()) as {
      list?: Array<{ mail_id: number; mail_from: string }>
    }
    const mails = body.list ?? []
    // Only mails newer than the pre-init baseline — older OTPs are
    // already consumed and would 422 on authenticate.
    const fresh = mails
      .filter((m) => (m.mail_from ?? '').includes('privy.io') && m.mail_id > sinceMailId)
      .sort((a, b) => b.mail_id - a.mail_id) // newest first
    if (fresh.length > 0) {
      const detail = await fetch(
        `${GM_API}?f=fetch_email&email_id=${fresh[0].mail_id}&sid_token=${sid}`,
        { signal: AbortSignal.timeout(15_000) },
      )
      if (detail.ok) {
        const d = (await detail.json()) as { mail_body?: string }
        const otp = d.mail_body?.match(/\b(\d{6})\b/)?.[1]
        if (otp) return otp
      }
    }
  }
  throw new Error('GuerrillaMail: no Privy OTP mail within 75s')
}

// ── Privy passwordless ──────────────────────────────────────

export async function requestPrivyOtp(email: string): Promise<void> {
  const res = await fetch('https://auth.privy.io/api/v1/passwordless/init', {
    method: 'POST',
    headers: privyHeaders(),
    body: JSON.stringify({ email }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Privy passwordless/init failed: HTTP ${res.status}`)
}

export async function authenticatePrivyOtp(
  email: string,
  code: string,
): Promise<ReauthCredentials> {
  const res = await fetch('https://auth.privy.io/api/v1/passwordless/authenticate', {
    method: 'POST',
    headers: privyHeaders(),
    body: JSON.stringify({ email, code, mode: 'login-or-sign-up' }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Privy passwordless/authenticate failed: HTTP ${res.status}`)
  const body = (await res.json()) as { token?: string; refresh_token?: string }
  if (!body.token) throw new Error('Privy authenticate: no token in response')
  return { token: body.token, refreshToken: body.refresh_token ?? '' }
}

// ── Orchestration ───────────────────────────────────────────

let reauthInflight: Promise<ReauthCredentials> | null = null

/**
 * Full self-heal: OTP to MOBY_EMAIL, poll inbox, authenticate.
 * Single-flight — concurrent 401s share one re-auth.
 * Permanent inboxes (anything except guerrillamail domains) skip the
 * GuerrillaMail adoption step; the code lands in the real mailbox.
 */
export async function reauthenticateViaEmail(email: string): Promise<ReauthCredentials> {
  if (reauthInflight) return reauthInflight
  reauthInflight = (async () => {
    logger.info(`moby self-heal: requesting Privy OTP for ${email}`, 'moby')
    const isGuerrilla = /guerrillamail/.test(email.split('@')[1] ?? '')
    // Baseline BEFORE init: any existing privy.io mail predates this OTP.
    let sid: string | null = null
    let baselineMaxId = 0
    if (isGuerrilla) {
      sid = await gmSetUser(email)
      baselineMaxId = await gmBaselineMaxPrivyMailId(sid)
    }
    await requestPrivyOtp(email)
    let code: string
    if (isGuerrilla && sid) {
      code = await gmFetchPrivyMail(sid, baselineMaxId)
    } else {
      // Non-Guerrilla inbox: no server-side reader wired — caller must
      // supply the code out-of-band. Fail loudly instead of stalling.
      throw new Error(
        `MOBY_EMAIL ${email} is not a GuerrillaMail address — automatic OTP ` +
          'retrieval only supports guerrillamail.com domains (or extend gmFetchPrivyMail).',
      )
    }
    logger.info('moby self-heal: OTP received, authenticating', 'moby')
    return authenticatePrivyOtp(email, code)
  })()
  try {
    return await reauthInflight
  } finally {
    reauthInflight = null
  }
}

/** Test helper. */
export function resetReauthState(): void {
  reauthInflight = null
  gmSession = null
}
