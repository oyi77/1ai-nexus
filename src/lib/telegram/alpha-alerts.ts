// ─────────────────────────────────────────────────────────────
// Alpha Strong-Buy Alerts — opt-in broadcast push.
// When the conviction engine flags an IDX stock with alpha-engine
// backing at high conviction, push it to every telegram-linked
// user with alphaAlertsEnabled. No watchlist needed.
//
// Dedupe per code with 24h cooldown so a multi-day strong-buy
// doesn't spam. Wired into the daily alpha-track cron (runs after
// harvesters + record + evaluate).
// ─────────────────────────────────────────────────────────────

import { prisma } from "@/lib/db"
import { getCachedConvictionResult } from "@/lib/conviction/build"
import { sendUserAlert } from "./alert-service"

const ALPHA_MIN_CONVICTION = 75
const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000
const MAX_ALERTED = 500
const MAX_ALERTS_PER_RUN = 10

const alertedCodes = new Map<string, number>() // code -> timestamp

function shouldAlert(code: string): boolean {
  const last = alertedCodes.get(code)
  if (last === undefined) return true
  return Date.now() - last > ALERT_COOLDOWN_MS
}

function pruneAlertedCodes(): void {
  if (alertedCodes.size <= MAX_ALERTED) return
  const now = Date.now()
  for (const [k, ts] of alertedCodes) {
    if (now - ts > ALERT_COOLDOWN_MS) alertedCodes.delete(k)
  }
  if (alertedCodes.size > MAX_ALERTED) {
    const sorted = [...alertedCodes.entries()].sort((a, b) => a[1] - b[1])
    for (const [k] of sorted.slice(0, alertedCodes.size - MAX_ALERTED)) alertedCodes.delete(k)
  }
}

function formatAlphaAlert(item: {
  symbol: string
  name: string
  price: number
  conviction: number
  reasons: Array<{ text: string; weight: number }>
}): string {
  const top = item.reasons.slice(0, 2).map((r) => `• ${r.text}`)
  return [
    `🚀 ALPHA strong-buy: ${item.symbol}`,
    `${item.name} @ ${item.price > 0 ? item.price.toLocaleString("id-ID") : "—"}`,
    `Conviction ${item.conviction}/100`,
    ...top,
  ].join("\n")
}

export async function runAlphaStrongBuyAlerts(): Promise<{
  candidates: number
  usersChecked: number
  alertsSent: number
  alertsSkipped: number
}> {
  try {
    const conviction = await getCachedConvictionResult()
    const idxMarket = (conviction?.markets ?? []).find((m) => m.id === "IDX")
    const candidates = (idxMarket?.items ?? []).filter(
      (i) =>
        i.action === "BUY" &&
        i.conviction >= ALPHA_MIN_CONVICTION &&
        (i.sources ?? []).includes("alpha-engine"),
    )

    const users = await prisma.user.findMany({
      where: { telegramChatId: { not: null }, alphaAlertsEnabled: true },
      select: { id: true },
    })

    let alertsSent = 0
    let alertsSkipped = 0

    for (const c of candidates.slice(0, MAX_ALERTS_PER_RUN)) {
      if (!shouldAlert(c.symbol)) {
        alertsSkipped += users.length
        continue
      }
      const msg = formatAlphaAlert(c)
      let sentToAnyone = false
      for (const user of users) {
        const res = await sendUserAlert(user.id, msg)
        if (res.sent) {
          alertsSent++
          sentToAnyone = true
        } else {
          alertsSkipped++
        }
      }
      if (sentToAnyone) alertedCodes.set(c.symbol, Date.now())
    }

    pruneAlertedCodes()
    return { candidates: candidates.length, usersChecked: users.length, alertsSent, alertsSkipped }
  } catch (err) {
    console.error("[AlphaAlerts] run error:", (err as Error).message)
    return { candidates: 0, usersChecked: 0, alertsSent: 0, alertsSkipped: 0 }
  }
}
