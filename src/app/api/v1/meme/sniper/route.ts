// ─────────────────────────────────────────────────────────────
// POST /api/v1/meme/sniper   — screen one on-chain payload, optionally
//                              push the alert to Telegram.
//                              SCREENING ONLY: never executes.
//
// Self-authenticating: NEXUS_API_KEYS / API_KEYS service keys or the
// TELEGRAM_CRON_SECRET bearer (same contract as /telegram/personal-alerts).
// Listed in middleware PUBLIC_ROUTES so the middleware does not 401 an
// internal caller before this handler can accept a service key.
//
// Body (POST):
//   { payload: SniperPayload, deliver?: boolean }
// The evaluator never trusts the caller's stage/status — it re-derives both.
// A push is gated on the same quality tier as the cron: an approved
// evaluator verdict is necessary but not sufficient, and no wallet evidence
// means no evidence (never a pass by omission).
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { evaluateSniper, deliverSniperAlert, resolveReviewChatId, type SniperPayload } from '@/lib/modules/derived/meme-sniper'
import { classifySignalTier, DEFAULT_DELIVERY_POLICY, shouldDeliver, tierLabel } from '@/lib/modules/derived/signal-tier-classify'

function parseServiceKeys(): Set<string> {
  const keys = new Set<string>()
  for (const env of ['NEXUS_API_KEYS', 'API_KEYS']) {
    for (const k of (process.env[env] || '').split(',')) {
      if (k.trim()) keys.add(k.trim())
    }
  }
  return keys
}

function isInternalKey(request: Request): boolean {
  const cron = process.env.TELEGRAM_CRON_SECRET || ''
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  // Accept: cron bearer, any NEXUS/API service key (middleware already
  // validated the bearer for non-public callers), or an explicit x-api-key.
  if (cron && bearer === cron) return true
  if (bearer && parseServiceKeys().has(bearer)) return true
  const key = request.headers.get('x-api-key') || ''
  return key !== '' && parseServiceKeys().has(key)
}

function isSniperPayload(v: unknown): v is SniperPayload {
  if (!v || typeof v !== 'object') return false
  const p = v as Partial<SniperPayload>
  return (
    typeof p.ticker === 'string' &&
    typeof p.contract === 'string' &&
    typeof p.ageMinutes === 'number' &&
    !!p.security &&
    typeof p.security === 'object' &&
    !!p.distribution &&
    typeof p.distribution === 'object' &&
    !!p.momentum &&
    typeof p.momentum === 'object' &&
    typeof p.momentum.marketCap === 'number' &&
    typeof p.momentum.volume5m === 'number'
  )
}

export async function GET(request: Request) {
  if (!isInternalKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Screening-only surface: no circuit, no execution state to report.
  return NextResponse.json({ data: { mode: 'screening' }, error: null })
}

export async function POST(request: Request) {
  if (!isInternalKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { payload?: unknown; deliver?: boolean }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!isSniperPayload(body.payload)) {
    return NextResponse.json(
      { error: 'Invalid payload: ticker, contract, ageMinutes, security, distribution and momentum{marketCap,volume5m} are required' },
      { status: 400 },
    )
  }

  const decision = evaluateSniper(body.payload)

  const tier = classifySignalTier({
    decision,
    smartMoney: null,
    ageMinutes: body.payload.ageMinutes,
    staleAfterMinutes: 60 * 12,
    dataComplete: true,
  })

  // Only tiers the delivery policy allows are pushed. A REJECT, an expired
  // payload, or a signal without wallet evidence stays API-only. The push
  // is operator-facing (the caller is an internal service, not the audit
  // pipeline), so it goes to the review chat - the public channel receives
  // only cron signals that survived the full audit + wallet gate.
  //
  // An EMPTY review chat means "do not send": passing '' would make
  // deliverSniperAlert fall through to SNIPER_TELEGRAM_CHAT_ID (the sale
  // channel).
  const reviewChat = resolveReviewChatId()
  let delivered = false
  if (body.deliver === true && reviewChat !== '' && shouldDeliver(tier.tier, DEFAULT_DELIVERY_POLICY)) {
    delivered = await deliverSniperAlert(`${tierLabel(tier.tier)}\n${decision.alert}`, reviewChat)
  }

  return NextResponse.json({
    data: {
      ...decision,
      tier: tier.tier,
      delivered,
      deliverySkipped:
        delivered || body.deliver !== true
          ? null
          : reviewChat === ''
            ? 'no operator chat configured'
            : 'tier not deliverable under policy',
    },
    error: null,
  })
}