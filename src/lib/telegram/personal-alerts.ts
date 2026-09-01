// ─────────────────────────────────────────────────────────────
// Personal Watchlist Alerts — per-user Telegram push.
// For every user with a linked Telegram chat + a watchlist, check
// current conviction and alert them when a watched symbol crosses a
// strong-signal threshold. Market + symbol + conviction + action.
//
// Read the alarm state from a shared module-level Set (dedupe), so a
// burst of identical conviction frames doesn't spam the same alert.
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'
import { getCachedConvictionResult } from '@/lib/conviction/build'
import { sendUserAlert } from './alert-service'

export const MIN_PERSONAL_CONVICTION = 70 // alert when a watched symbol >= 70 (BUY) or <= 30 (SELL)
const MAX_ALERTED = 500

// Dedupe: (userId, symbol, action) — one alert per symbol per direction,
// bounded so the set can't grow unbounded across the process lifetime.
const alertedKeys = new Map<string, number>() // key -> timestamp
const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000 // re-alert same symbol/direction after 6h

function makeKey(userId: string, symbol: string, action: string): string {
  return `${userId}\u0000${symbol}\u0000${action}`
}

function shouldAlert(key: string): boolean {
  const last = alertedKeys.get(key)
  if (last !== undefined) return Date.now() - last > ALERT_COOLDOWN_MS
  return true
}

function pruneAlertedKeys(): void {
  if (alertedKeys.size <= MAX_ALERTED) return
  const now = Date.now()
  for (const [k, ts] of alertedKeys) {
    if (now - ts > ALERT_COOLDOWN_MS) alertedKeys.delete(k)
  }
  // Still over? Drop oldest.
  if (alertedKeys.size > MAX_ALERTED) {
    const oldest = [...alertedKeys.entries()].sort((a, b) => a[1] - b[1])
    const toDrop = oldest.slice(0, alertedKeys.size - MAX_ALERTED)
    for (const [k] of toDrop) alertedKeys.delete(k)
  }
}

function formatPersonalAlert(symbol: string, market: string, conviction: number, action: string): string {
  const emoji = action === 'BUY' ? '🟢' : action === 'SELL' ? '🔴' : '⚪'
  return [
    `${emoji} ${symbol} · Conviction ${Math.round(conviction)}`,
    `Market: ${market === 'IDX' ? 'Indonesia Equities' : 'Crypto'}`,
    `Action: ${action} — crossed your watchlist threshold.`,
  ].join('\n')
}

export async function runPersonalWatchlistAlerts(): Promise<{
  usersChecked: number
  watchedSymbols: number
  alertsSent: number
  alertsSkipped: number
}> {
  try {
    // One shared conviction result — dedup via the cached accessor.
    const conviction = await getCachedConvictionResult()
    const markets = conviction?.markets ?? []
    // Build fast lookup: `market:symbol` -> { conviction, action }
    const byKey = new Map<string, { conviction: number; action: string }>()
    for (const m of markets) {
      for (const item of m.items ?? []) {
        const k = `${m.id}:${item.symbol}`
        byKey.set(k, { conviction: item.conviction, action: item.action })
      }
    }

    // All users with a linked chat + a watchlist.
    const users = await prisma.user.findMany({
      where: { telegramChatId: { not: null }, watchlist: { some: {} } },
      select: { id: true, telegramChatId: true, watchlist: { select: { symbol: true, market: true } } },
    })

    let alertsSent = 0
    let alertsSkipped = 0
    let watchedSymbols = 0

    for (const user of users) {
      const items = user.watchlist ?? []
      for (const w of items) {
        watchedSymbols++
        const hit = byKey.get(`${w.market}:${w.symbol}`)
        if (!hit) continue // no conviction row for this symbol
        const isStrong = hit.action === 'BUY' && hit.conviction >= MIN_PERSONAL_CONVICTION
        const isWeak = hit.action === 'SELL' && hit.conviction <= 100 - MIN_PERSONAL_CONVICTION
        if (!isStrong && !isWeak) continue

        const key = makeKey(user.id, w.symbol, hit.action)
        if (!shouldAlert(key)) { alertsSkipped++; continue }

        const msg = formatPersonalAlert(w.symbol, w.market, hit.conviction, hit.action)
        const res = await sendUserAlert(user.id, msg)
        if (res.sent) {
          alertedKeys.set(key, Date.now())
          alertsSent++
        } else {
          alertsSkipped++
        }
      }
    }

    pruneAlertedKeys()
    return { usersChecked: users.length, watchedSymbols, alertsSent, alertsSkipped }
  } catch (err) {
    console.error('[PersonalAlerts] run error:', (err as Error).message)
    return { usersChecked: 0, watchedSymbols: 0, alertsSent: 0, alertsSkipped: 0 }
  }
}
