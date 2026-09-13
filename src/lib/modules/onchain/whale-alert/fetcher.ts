// ─────────────────────────────────────────────────────────────
// Whale Alert fetcher — scrapes the Whale Alert Telegram channel
// (zero API key). Shared by the /api/v1/whale-alert route and the
// background refresher so the server-cache stays warm across
// process restarts: a cold route hit then serves cache instead of
// 502ing while t.me blips.
// ─────────────────────────────────────────────────────────────

export interface WhaleAlertItem {
  id: string
  amount: number
  symbol: string
  usd: number
  from: string
  to: string
  link?: string
}

export async function fetchWhaleAlerts(): Promise<WhaleAlertItem[]> {
  const res = await fetch('https://t.me/s/whale_alert_io', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) throw new Error(`Telegram fetch failed: ${res.status}`)

  const html = await res.text()
  const alerts: WhaleAlertItem[] = []
  const messageRegex = /<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/g
  let match

  while ((match = messageRegex.exec(html)) !== null) {
    const text = match[1].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&#036;/g, '$')
    if (!text.includes('🚨') || !text.includes('transferred from')) continue

    const clean = text.replace(/🚨/g, '').trim()
    const regex = /([0-9,.]+)\s*\$?([A-Za-z]+)\s*\(([0-9,.]+)\s*USD\)\s*transferred from\s*(.+?)\s*to\s*(.+?)(?:\s*$|\s*Details)/i
    const parsed = regex.exec(clean)
    if (!parsed) continue

    const linkRegex = /href="(https:\/\/whale-alert\.io\/transaction\/[^"]+)"/
    const linkMatch = linkRegex.exec(match[1])

    alerts.push({
      id: `${parsed[4]}-${parsed[5]}-${parsed[1]}`.replace(/\s+/g, '-').toLowerCase(),
      amount: parseFloat(parsed[1].replace(/,/g, '')),
      symbol: parsed[2].toUpperCase(),
      usd: parseFloat(parsed[3].replace(/,/g, '')),
      from: parsed[4].trim(),
      to: parsed[5].replace(/Details/g, '').trim(),
      link: linkMatch ? linkMatch[1] : undefined,
    })
  }

  return alerts.reverse()
}
