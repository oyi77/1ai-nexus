// ─────────────────────────────────────────────────────────────
// Signal Formatting — Pure functions to format AlphaSignal → Telegram message
// No state, no side effects, no imports from other modules
// ─────────────────────────────────────────────────────────────

import type { AlphaSignal } from '@/lib/modules/derived/alpha/types'

function fmtPrice(n: number | null): string {
  if (n === null || n === undefined) return '—'
  if (n >= 1000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  if (n >= 1) return `$${n.toFixed(2)}`
  if (n >= 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(6)}`
}

function dirEmoji(direction: string): string {
  switch (direction) {
    case 'bullish': return '🟢'
    case 'bearish': return '🔴'
    default: return '⚪'
  }
}

function dirLabel(direction: string): string {
  switch (direction) {
    case 'bullish': return 'LONG'
    case 'bearish': return 'SHORT'
    default: return 'NEUTRAL'
  }
}

function formatConfidenceBar(confidence: number): string {
  const filled = Math.round(confidence / 10)
  const empty = 10 - filled
  return '█'.repeat(filled) + '░'.repeat(empty)
}

/** Format one signal as a full Telegram message with entry, TP/SL, expiry */
export function formatSignalMessage(signal: AlphaSignal): string {
  const emoji = dirEmoji(signal.direction)
  const dir = dirLabel(signal.direction)
  const remaining = Math.max(0, Math.round((signal.expiresAt - Date.now()) / 3_600_000))
  const bar = formatConfidenceBar(signal.confidence)

  const lines: string[] = [
    `${emoji} *${dir} ${signal.symbol}*  (${signal.confidence}%)`,
    `${bar}`,
    '',
    signal.reasoning,
    '',
    `Entry: \`${fmtPrice(signal.entry)}\``,
  ]

  if (signal.tp1 !== null) lines.push(`TP1: \`${fmtPrice(signal.tp1)}\``)
  if (signal.tp2 !== null) lines.push(`TP2: \`${fmtPrice(signal.tp2)}\``)
  if (signal.tp3 !== null) lines.push(`TP3: \`${fmtPrice(signal.tp3)}\``)
  if (signal.sl !== null) lines.push(`SL:   \`${fmtPrice(signal.sl)}\``)

  lines.push(
    '',
    `⏱ Valid for: *${signal.validPeriod.toUpperCase()}* (${remaining}h left)`,
    `📡 Sources: ${signal.sources.join(', ')}`,
  )

  return lines.join('\n')
}

/** Format a list of signals as a Telegram summary message */
export function formatSignalSummary(signals: AlphaSignal[], title?: string): string {
  if (!signals.length) return '📡 *No active signals*\n\nNo signals currently — check back later.'

  const lines: string[] = [
    title ?? `📡 *Active Signals* — ${signals.length} found`,
    '',
  ]

  for (const s of signals.slice(0, 10)) {
    const emoji = dirEmoji(s.direction)
    const remaining = Math.max(0, Math.round((s.expiresAt - Date.now()) / 3_600_000))
    lines.push(`${emoji} *${s.symbol}* ${dirLabel(s.direction)} ${s.confidence}% (${remaining}h)`)
    lines.push(`   ${s.reasoning.slice(0, 80)}${s.reasoning.length > 80 ? '…' : ''}`)
    if (s.entry !== null) lines.push(`   Entry: ${fmtPrice(s.entry)}`)
    lines.push('')
  }

  return lines.join('\n')
}
