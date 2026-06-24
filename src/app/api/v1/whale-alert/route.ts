// ─────────────────────────────────────────────────────────────
// GET /api/v1/whale-alert — Multi-chain whale alerts
// Scraped from Whale Alert Telegram channel (zero API key)
// Server-side cached: 60s TTL, single-flight dedup
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { getCached } from '@/lib/api/server-cache'

interface WhaleAlertItem {
  id: string
  amount: number
  symbol: string
  usd: number
  from: string
  to: string
  link?: string
}

async function fetchWhaleAlerts(): Promise<WhaleAlertItem[]> {
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
    let text = match[1].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&#036;/g, '$')
    if (!text.includes('🚨') || !text.includes('transferred from')) continue

    const clean = text.replace(/🚨/g, '').trim()
    const regex = /([0-9,.]+)\s*\$?([A-Za-z]+)\s*\(([0-9,.]+)\s*USD\)\s*transferred from\s*(.+?)\s*to\s*(.+?)(?:\s*$|\s*Details)/i
    const parsed = regex.exec(clean)
    if (!parsed) continue

    const linkRegex = /href="(https:\/\/whale-alert\.io\/transaction\/[^"]+)"/
    const linkMatch = linkRegex.exec(match[1])

    alerts.push({
      id: `wa-${alerts.length}-${Date.now()}`,
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

export async function GET() {
  try {
    const { data, fromCache } = await getCached('whale-alert', 60_000, fetchWhaleAlerts)
    const resp = NextResponse.json({ data: { items: data.slice(0, 20), count: data.length }, error: null })
    resp.headers.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120')
    resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
    return resp
  } catch (error) {
    console.error('Whale Alert error:', error)
    return NextResponse.json({ data: null, error: 'Failed to fetch Whale Alerts' }, { status: 502 })
  }
}
