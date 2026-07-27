// ─────────────────────────────────────────────────────────────
// Telegram Signal Publisher — Orchestrates signal broadcast
// Tracks subscribers, deduplicates broadcasts, calls Telegram API
// ─────────────────────────────────────────────────────────────

import { getAlphaSignals } from '@/lib/modules/derived/alpha-engine'
import { formatSignalMessage } from './signal-formatter'

// ─── State ────────────────────────────────────────────────────

const signalSubscribers = new Set<string>()
const broadcastedSignals = new Set<string>()
const MAX_BROADCASTED = 500
const MIN_BROADCAST_CONFIDENCE = 65

// ─── Subscription Management ─────────────────────────────────

export function subscribeSignals(chatId: string): boolean {
  signalSubscribers.add(chatId)
  return true
}

export function unsubscribeSignals(chatId: string): boolean {
  return signalSubscribers.delete(chatId)
}

export function isSubscribedToSignals(chatId: string): boolean {
  return signalSubscribers.has(chatId)
}

export function getSignalSubscriberCount(): number {
  return signalSubscribers.size
}

// ─── Broadcast ────────────────────────────────────────────────

export async function fetchAndBroadcastSignals(): Promise<{
  newSignals: number
  broadcastTo: number
  sent: number
  failed: number
}> {
  try {
    const result = await getAlphaSignals()
    const signals = result.signals

    const newSignals = signals.filter(
      s => s.confidence >= MIN_BROADCAST_CONFIDENCE && !broadcastedSignals.has(s.id),
    )

    if (!newSignals.length) {
      return { newSignals: 0, broadcastTo: 0, sent: 0, failed: 0 }
    }

    for (const s of newSignals) {
      broadcastedSignals.add(s.id)
    }
    if (broadcastedSignals.size > MAX_BROADCASTED) {
      const entries = Array.from(broadcastedSignals)
      const toRemove = entries.slice(0, entries.length - MAX_BROADCASTED)
      for (const id of toRemove) broadcastedSignals.delete(id)
    }

    let totalSent = 0
    let totalFailed = 0

    for (const signal of newSignals) {
      const message = formatSignalMessage(signal)
      for (const chatId of signalSubscribers) {
        try {
          const ok = await sendTelegramMessage(chatId, message)
          if (ok) totalSent++
          else totalFailed++
        } catch {
          totalFailed++
        }
      }
    }

    return {
      newSignals: newSignals.length,
      broadcastTo: signalSubscribers.size,
      sent: totalSent,
      failed: totalFailed,
    }
  } catch (err) {
    console.error('[SignalPublisher] Broadcast error:', (err as Error).message)
    return { newSignals: 0, broadcastTo: 0, sent: 0, failed: 0 }
  }
}

// ─── Transport ────────────────────────────────────────────────

async function sendTelegramMessage(chatId: string, message: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return false

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: Number(chatId),
          text: message,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    )
    const data = await res.json() as { ok: boolean }
    return data.ok
  } catch {
    return false
  }
}
