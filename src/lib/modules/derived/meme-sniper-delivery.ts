// ─────────────────────────────────────────────────────────────
// Meme sniper — Telegram delivery + persisted delivery log.
// Verbatim carve from meme-sniper.ts (800-line gate split).
// Consumers keep importing from '@/lib/modules/derived/meme-sniper'.
// ─────────────────────────────────────────────────────────────
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ── Telegram delivery ─────────────────────────────────────────

const DELIVERY_LOG_MAX_ENTRIES = 500
const DELIVERY_LOG_DEFAULT_PATH = join(process.cwd(), 'data', 'sniper-delivery-log.json')
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

function deliveryLogPath(): string {
  return process.env.SNIPER_DELIVERY_LOG_PATH || DELIVERY_LOG_DEFAULT_PATH
}

/** One persisted Telegram delivery attempt/result (append-only ring buffer). */
export interface SniperDeliveryLogEntry {
  at: string
  chatId: string | null
  contract: string | null
  messageTextPrefix: string
  ok: boolean
  status: number | null
  error: string | null
  attemptCount: number
  truncated: boolean
}

export interface SniperDeliveryLog {
  /** Newest first. */
  entries: SniperDeliveryLogEntry[]
  updatedAt: string | null
}

function emptyDeliveryLog(): SniperDeliveryLog {
  return { entries: [], updatedAt: null }
}

/**
 * Read the persisted delivery log; a missing or corrupt file reads as
 * empty — an unreadable log must never brick an alert.
 */
export function readSniperDeliveryLog(): SniperDeliveryLog {
  const path = deliveryLogPath()
  if (!existsSync(path)) return emptyDeliveryLog()
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<SniperDeliveryLog>
    if (!Array.isArray(raw.entries)) return emptyDeliveryLog()
    return {
      entries: raw.entries,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    }
  } catch {
    return emptyDeliveryLog()
  }
}

/** Append one entry (newest first), capped at the last 500. Best-effort. */
export function appendSniperDeliveryLog(entry: SniperDeliveryLogEntry): SniperDeliveryLog {
  const log = readSniperDeliveryLog()
  const next: SniperDeliveryLog = {
    entries: [entry, ...log.entries].slice(0, DELIVERY_LOG_MAX_ENTRIES),
    updatedAt: entry.at,
  }
  try {
    const path = deliveryLogPath()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(next, null, 2))
  } catch {
    // Delivery observability is best-effort — a full disk must not fail the send.
  }
  return next
}

/**
 * Extract a Solana mint from an alert body. Deterministic and simple:
 * 1. the first `<code>…</code>` token (how both alert builders render mints),
 * 2. the first base58 token ending in `pump` (pump.fun mints),
 * 3. the first generic 32–44 char base58 token.
 * Returns null when no mint-shaped token exists.
 */
export function extractContractFromAlert(text: string): string | null {
  if (!text) return null
  const code = text.match(/<code>([^<]+)<\/code>/)
  if (code && BASE58_RE.test(code[1])) return code[1]
  const words = text.split(/[^1-9A-HJ-NP-Za-km-z]+/)
  for (const word of words) {
    if (BASE58_RE.test(word) && word.endsWith('pump')) return word
  }
  for (const word of words) {
    if (BASE58_RE.test(word)) return word
  }
  return null
}

/**
 * Pure per-contract cooldown gate. Suppresses when a prior successful
 * delivery of the same contract exists inside the cooldown window.
 */
export function shouldSuppressDelivery(
  contract: string | null,
  lastOkAtMs: number | null,
  nowMs: number,
  cooldownMs: number,
): boolean {
  if (!contract || cooldownMs <= 0 || lastOkAtMs === null) return false
  return nowMs - lastOkAtMs < cooldownMs
}

function deliveryCooldownMs(): number {
  const raw = process.env.SNIPER_DELIVERY_COOLDOWN_MS
  if (!raw) return 0
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * Send an alert through the ecosystem's proven channel chain:
 * SCREENING ONLY: this repo never executes. Execution belongs to
 * 1ai-trade-dex; SNIPER_EXECUTE_ENABLED stays unset here, so the
 * evaluator can only ever emit WATCHLIST (no order path exists).
 *
 * Dedicated sniper bot first (SNIPER_TELEGRAM_BOT_TOKEN → its own
 * SNIPER_TELEGRAM_CHAT_ID), then the ecosystem chain:
 * HUB_TELEGRAM_BOT_TOKEN → TELEGRAM_BOT_TOKEN, and
 * HUB_TELEGRAM_OWNER_CHAT_ID → TELEGRAM_ALERT_CHAT_ID → TELEGRAM_ADMIN_CHAT_ID.
 *
 * parse_mode is HTML, NOT legacy Markdown. Proven live 2026-10-12: legacy
 * Markdown 400s with "can't parse entities" whenever an unescaped `_` from
 * a ticker/mint (e.g. `7tZt1LXb`, `bot_`) opens an italic span, and the
 * failure is silent (returns false → review digest logs "telegram
 * rejected"). HTML only needs `&`, `<`, `>` escaped, so dynamic token data
 * (which never contains those) cannot break the message. See `escapeSignalHtml`.
 * Returns false (never throws) when unconfigured or the API rejects.
 */
export async function deliverSniperAlert(
  text: string,
  chatId?: string,
  replyMarkup?: { inline_keyboard: Array<Array<{ text: string; url: string }>> },
): Promise<boolean> {
  const token =
    process.env.SNIPER_TELEGRAM_BOT_TOKEN ||
    process.env.HUB_TELEGRAM_BOT_TOKEN ||
    process.env.TELEGRAM_BOT_TOKEN ||
    ''
  const chat =
    chatId ||
    process.env.SNIPER_TELEGRAM_CHAT_ID ||
    process.env.HUB_TELEGRAM_OWNER_CHAT_ID ||
    process.env.TELEGRAM_ALERT_CHAT_ID ||
    process.env.TELEGRAM_ADMIN_CHAT_ID ||
    ''
  const truncated = text.length > 4096
  const messageTextPrefix = (truncated ? text.slice(0, 4090) + '…' : text).slice(0, 80)
  const contract = extractContractFromAlert(text)
  const logEntry = (ok: boolean, status: number | null, error: string | null, attemptCount: number): void => {
    const entry: SniperDeliveryLogEntry = {
      at: new Date().toISOString(),
      chatId: chat || null,
      contract,
      messageTextPrefix,
      ok,
      status,
      error,
      attemptCount,
      truncated,
    }
    appendSniperDeliveryLog(entry)
    // DB-primary: upsert to Postgres via the DB store (fire-and-forget;
    // saveDeliveryEntries never throws and logs its own DB errors). Dynamic
    // import avoids a module-load cycle (db-delivery-store imports this
    // module for its types). Skipped when SNIPER_DELIVERY_DB is off.
    const deliveryDbOff =
      process.env.SNIPER_DELIVERY_DB === 'off' ||
      process.env.SNIPER_DELIVERY_DB === 'false' ||
      process.env.SNIPER_DELIVERY_DB === '0'
    if (!deliveryDbOff) {
      void import('./db-delivery-store')
        .then((m) => m.saveDeliveryEntries([entry]))
        .catch(() => {
          // best-effort: DB failure is logged inside saveDeliveryEntries
        })
    }
  }

  if (!token || !chat) {
    logEntry(false, null, 'unconfigured', 0)
    return false
  }

  const cooldownMs = deliveryCooldownMs()
  if (cooldownMs > 0 && contract) {
    let lastOkAtMs: number | null = null
    for (const e of readSniperDeliveryLog().entries) {
      if (!e.ok || e.contract !== contract) continue
      const t = Date.parse(e.at)
      if (Number.isFinite(t)) {
        lastOkAtMs = t
        break
      }
    }
    if (shouldSuppressDelivery(contract, lastOkAtMs, Date.now(), cooldownMs)) {
      console.log(`[sniper] delivery cooldown suppressed ${contract}`)
      logEntry(false, null, 'cooldown', 0)
      return false
    }
  }

  // Telegram caps sendMessage text at 4096 chars — truncate there, never let
  // a digest die on 400 simply for being one block too long.
  const body = truncated ? text.slice(0, 4090) + '…' : text
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chat,
          text: body,
          parse_mode: 'HTML',
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      })
      if (res.ok) {
        logEntry(true, res.status, null, attempt)
        return true
      }
      const errBody = await res.text().catch(() => '')
      console.error(`[sniper] telegram send failed: HTTP ${res.status} ${errBody.slice(0, 300)}`)
      if (res.status === 400) {
        logEntry(false, res.status, errBody.slice(0, 300), attempt)
        return false
      }
      if (res.status === 429) {
        const ra = errBody.match(/"retry_after"\s*:\s*(\d+)/)
        const wait = ra ? Math.min(Number(ra[1]), 30) : 5
        if (attempt === 1) { await new Promise((r) => setTimeout(r, wait * 1000)); continue }
      }
      logEntry(false, res.status, errBody.slice(0, 300), attempt)
      return false
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[sniper] telegram send error (attempt ${attempt}/2): ${msg}`)
      if (attempt === 2) {
        logEntry(false, null, msg, attempt)
        return false
      }
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
  logEntry(false, null, 'retries exhausted', 2)
  return false
}
