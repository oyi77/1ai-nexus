// ─────────────────────────────────────────────────────────────
// Sniper bot — inbound Telegram command handler.
//
// The sniper bot (@Vilonasnipercoinbot) was push-only: SNIPER_TELEGRAM_BOT_TOKEN
// drove outbound deliverSniperAlert sends. This module adds a long-poll
// listener that handles /scan, /top, /check commands from the operator's
// private review chat.
//
// SAFETY: only SNIPER_REVIEW_CHAT_ID may issue commands. No command triggers
// spending or execution — /scan screens, /check evaluates, /top reads.
// ─────────────────────────────────────────────────────────────

import { runSniperScan, type SniperScanResult } from './sniper-scan'
import { readSniperLog, type SniperLogEntry } from './sniper-log'
import { evaluateSniper } from './meme-sniper'
import { escapeHtml, type SniperPayload, type SniperDecision } from './meme-sniper-types'
import { escapeSignalHtml } from './signal-tier'

// ── Config ────────────────────────────────────────────────────

const TG_API = 'https://api.telegram.org'
const LONG_POLL_TIMEOUT_S = 30
const MAX_BACKOFF_MS = 30_000
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export type BotCommand =
  | { cmd: 'scan' }
  | { cmd: 'top' }
  | { cmd: 'check'; contract: string }
  | { cmd: 'unknown'; raw: string }
  | { cmd: 'empty' }

/**
 * Parse an inbound message text into a typed command.
 * Handles `/scan`, `/top`, `/check <CA>` (with optional @bot suffix).
 * A bare `/check` with no argument returns `unknown`.
 */
export function parseCommand(text: string): BotCommand {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return { cmd: 'empty' }

  // Strip @botname suffix (e.g. "/scan@Vilonasnipercoinbot")
  const withoutBot = trimmed.replace(/@\S+/, '')
  const parts = withoutBot.split(/\s+/)
  const cmd = parts[0].toLowerCase()

  if (cmd === '/scan') return { cmd: 'scan' }
  if (cmd === '/top') return { cmd: 'top' }
  if (cmd === '/check') {
    const ca = parts[1] ?? ''
    if (!ca || !BASE58_RE.test(ca)) return { cmd: 'unknown', raw: trimmed }
    return { cmd: 'check', contract: ca }
  }
  return { cmd: 'unknown', raw: trimmed }
}

// ── Response formatters (pure, HTML) ──────────────────────────

/** Format /scan result as an HTML message. */
export function formatScanResult(res: SniperScanResult): string {
  const topSignals = res.decisions.filter((d) => d.tier === 'HIGH_CONVICTION').length
  const lines: string[] = [
    '🔍 <b>Sniper Scan Pass</b>',
    '',
    `Scanned: ${res.scanned}`,
    `Screened (SIGNAL): ${res.screened}`,
    `Watchlist: ${res.watchlisted}`,
    `Rejected: ${res.rejected}`,
    `Delivered: ${res.delivered}`,
    `Top signals: ${topSignals}`,
  ]
  if (res.errors.length > 0) {
    lines.push('', `<b>Errors (${res.errors.length}):</b>`)
    for (const e of res.errors.slice(0, 3)) lines.push(`• ${escapeSignalHtml(e)}`)
  }
  return lines.join('\n')
}

/** Format a single log entry for /top output. */
export function formatLogEntry(entry: SniperLogEntry, index: number): string {
  const tier = escapeSignalHtml(entry.tier)
  const ticker = escapeSignalHtml(entry.ticker)
  const contract = escapeHtml(entry.contract)
  const status = escapeSignalHtml(entry.status)
  const volMc = Number.isFinite(entry.metrics.volMcRatio)
    ? entry.metrics.volMcRatio.toFixed(2) + 'x'
    : 'n/a'
  const delivered = entry.delivered ? ' ✉' : ''
  return (
    `${index + 1}. <b>[${tier}]</b> ${ticker} — ${status}${delivered}\n` +
    `   <code>${contract}</code>\n` +
    `   Vol/MC: ${volMc} · ${escapeSignalHtml(entry.metrics.ageLabel)}`
  )
}

/** Format /top output from log entries. */
export function formatTopEntries(entries: SniperLogEntry[]): string {
  if (entries.length === 0) {
    return '📋 <b>Recent Signals</b>\n\nNo entries in the sniper log yet.'
  }
  const lines: string[] = ['📋 <b>Recent Signals (top 5)</b>', '']
  for (let i = 0; i < Math.min(entries.length, 5); i++) {
    lines.push(formatLogEntry(entries[i], i))
  }
  return lines.join('\n')
}

/** Format /check verdict as an HTML message. */
export function formatCheckVerdict(decision: SniperDecision, contract: string): string {
  const status = decision.status
  const icon = status === 'SIGNAL' ? '✅' : status === 'WATCHLIST' ? '⚠️' : '🔴'
  const lines: string[] = [
    `${icon} <b>Sniper Check</b>`,
    '',
    `Contract: <code>${escapeHtml(contract)}</code>`,
    `Verdict: <b>${escapeSignalHtml(status)}</b>`,
    `Rationale: ${escapeSignalHtml(decision.rationale)}`,
  ]
  if (decision.rejections.length > 0) {
    lines.push('', `<b>Rejections (${decision.rejections.length}):</b>`)
    for (const r of decision.rejections.slice(0, 5)) {
      lines.push(`• ${escapeSignalHtml(r)}`)
    }
  }
  if (decision.warnings.length > 0) {
    lines.push('', `<b>Warnings:</b>`)
    for (const w of decision.warnings.slice(0, 3)) {
      lines.push(`• ${escapeSignalHtml(w)}`)
    }
  }
  const m = decision.metrics
  lines.push(
    '',
    `<b>Metrics:</b>`,
    `Stage: ${escapeSignalHtml(m.stageLabel)} (${m.ageLabel})`,
    `Vol/MC: ${Number.isFinite(m.volMcRatio) ? m.volMcRatio.toFixed(2) + 'x' : 'n/a'} (req ${m.requiredRatio}x)`,
    `Dev: ${m.devPercent ?? 'n/a'}% | Sniper: ${m.sniperPercent ?? 'n/a'}% | Bundler: ${m.bundlerPercent ?? 'n/a'}%`,
  )
  return lines.join('\n')
}

// ── Command handler (pure, injectable) ────────────────────────

export interface CommandDeps {
  runScan: typeof runSniperScan
  readLog: typeof readSniperLog
  evalSniper: typeof evaluateSniper
}

const DEFAULT_COMMAND_DEPS: CommandDeps = {
  runScan: runSniperScan,
  readLog: readSniperLog,
  evalSniper: evaluateSniper,
}

/**
 * Handle a parsed command and return the HTML response text.
 * Returns null when the command produces no reply (e.g. empty/non-command).
 *
 * Auth gate: only `allowedChatId` may receive a response. Non-whitelisted
 * chats get "Unauthorized" — no command is executed.
 */
export async function handleCommand(
  command: BotCommand,
  chatId: string,
  allowedChatId: string,
  deps: CommandDeps = DEFAULT_COMMAND_DEPS,
): Promise<string | null> {
  // Auth gate — reject before any command logic runs.
  if (!allowedChatId || chatId !== allowedChatId) {
    return '⛔ Unauthorized'
  }

  switch (command.cmd) {
    case 'scan': {
      const res = await deps.runScan({ limit: 3, deliver: false })
      return formatScanResult(res)
    }
    case 'top': {
      const log = deps.readLog()
      return formatTopEntries(log.entries)
    }
    case 'check': {
      const payload = payloadFromContract(command.contract)
      const decision = deps.evalSniper(payload)
      return formatCheckVerdict(decision, command.contract)
    }
    case 'unknown': {
      return (
        '❓ Unknown command.\n\n' +
        '<b>Available commands:</b>\n' +
        '/scan — trigger a live sniper scan pass\n' +
        '/top — show recent signals from the log\n' +
        '/check &lt;CA&gt; — screen a contract address'
      )
    }
    case 'empty':
      return null
  }
}

/**
 * Build a minimal SniperPayload from just a contract address.
 *
 * Without live audit data (rugcheck/birdeye), every field is unproven
 * (null). The evaluator treats unproven as the safest reading — security
 * gates require proven-false, so a null mintable/freeze is NOT a pass.
 * This honestly reports "no audit data available" rather than fabricating
 * clean numbers.
 */
function payloadFromContract(contract: string): SniperPayload {
  return {
    ticker: contract.slice(0, 8),
    contract,
    chain: 'solana',
    ageMinutes: 0,
    security: {
      mintable: null,
      freezeAuthority: null,
      lpBurnedPercent: null,
      lpLockedPercent: null,
      honeypot: null,
    },
    distribution: {
      devPercent: null,
      sniperPercent: null,
      bundlerPercent: null,
      insiderPercent: null,
      top10Percent: null,
      clusterPercent: null,
    },
    momentum: {
      marketCap: null,
      volume5m: null,
      top5AvgPnlPercent: null,
    },
  }
}

// ── Telegram API helpers ──────────────────────────────────────

async function sendMessage(token: string, chatId: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(`${TG_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 4096),
        parse_mode: 'HTML',
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[sniper-bot] sendMessage failed: HTTP ${res.status} ${body.slice(0, 200)}`)
      return false
    }
    return true
  } catch (e) {
    console.error(`[sniper-bot] sendMessage error: ${e instanceof Error ? e.message : String(e)}`)
    return false
  }
}

async function getUpdates(token: string, offset: number): Promise<TgUpdate[]> {
  const url = `${TG_API}/bot${token}/getUpdates?offset=${offset}&timeout=${LONG_POLL_TIMEOUT_S}&allowed_updates=${encodeURIComponent('["message"]')}`
  const res = await fetch(url, {
    signal: AbortSignal.timeout((LONG_POLL_TIMEOUT_S + 10) * 1000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`getUpdates HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as { ok: boolean; result?: TgUpdate[] }
  if (!data.ok || !Array.isArray(data.result)) return []
  return data.result
}

interface TgUpdate {
  update_id: number
  message?: {
    chat: { id: number }
    text?: string
  }
}

// ── Polling loop ──────────────────────────────────────────────

/**
 * Start the long-polling bot loop. Blocks forever (until process exit).
 *
 * Gates on SNIPER_TELEGRAM_BOT_TOKEN + SNIPER_REVIEW_CHAT_ID. If either
 * is missing, logs a warning and returns immediately (no-op).
 *
 * Network errors retry with exponential backoff up to 30s.
 */
export async function startBotLoop(): Promise<void> {
  const token =
    process.env.SNIPER_TELEGRAM_BOT_TOKEN ||
    process.env.HUB_TELEGRAM_BOT_TOKEN ||
    process.env.TELEGRAM_BOT_TOKEN ||
    ''
  const admin =
    process.env.SNIPER_REVIEW_CHAT_ID ||
    process.env.HUB_TELEGRAM_OWNER_CHAT_ID ||
    process.env.TELEGRAM_ADMIN_CHAT_ID ||
    ''

  if (!token) {
    console.warn('[sniper-bot] SNIPER_TELEGRAM_BOT_TOKEN not set — bot disabled')
    return
  }
  if (!admin) {
    console.warn('[sniper-bot] SNIPER_REVIEW_CHAT_ID not set — bot disabled')
    return
  }

  console.log(`[sniper-bot] polling started (admin chat: ${admin})`)
  let offset = 0
  let backoff = 1000

  for (;;) {
    try {
      const updates = await getUpdates(token, offset)
      backoff = 1000 // reset on success

      for (const upd of updates) {
        offset = upd.update_id + 1
        const msg = upd.message
        if (!msg || !msg.text) continue

        const chatId = String(msg.chat.id)
        const command = parseCommand(msg.text)
        const response = await handleCommand(command, chatId, admin)
        if (response) {
          await sendMessage(token, chatId, response)
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[sniper-bot] poll error: ${msg} — retrying in ${backoff}ms`)
      const { promise, resolve } = Promise.withResolvers<void>()
      setTimeout(resolve, backoff)
      await promise
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
    }
  }
}
