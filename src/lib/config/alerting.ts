// ─────────────────────────────────────────────────────────────
// Alerting helper — pushes degradation notices to Telegram when
// ALERT_WEBHOOK creds are present; log-only otherwise.
//
// Env:
//   TELEGRAM_ALERT_BOT_TOKEN  bot token
//   TELEGRAM_ALERT_CHAT_ID    target chat id
// ─────────────────────────────────────────────────────────────

export async function notifyAlert(title: string, detail: string): Promise<void> {
  const token = process.env.TELEGRAM_ALERT_BOT_TOKEN
  const chatId = process.env.TELEGRAM_ALERT_CHAT_ID
  const text = `[1ai-tracker] ${title}\n${detail}`
  if (!token || !chatId) {
    console.log(`[alert:noop] ${text}`)
    return
  }
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (e) {
    console.error('[alert] send failed:', String(e).slice(0, 120))
  }
}

/** True when the snapshot is older than maxAgeDays. */
export function isStaleIso(iso: string | null | undefined, maxAgeDays = 7): boolean {
  if (!iso) return true
  return Date.now() - new Date(iso).getTime() > maxAgeDays * 86_400_000
}
