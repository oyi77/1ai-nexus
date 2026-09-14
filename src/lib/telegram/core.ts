// NEXUS Telegram Bot — shared core: transport, state, formatting helpers.

export const TELEGRAM_API = 'https://api.telegram.org/bot'
export const MAX_RETRIES = 3
export const RETRY_BASE_MS = 1000

export const registeredChats = new Set<string>()
export let botToken = ''
export let pollingOffset = 0
export let isPolling = false
export const startTime = Date.now()

// ─── Core API ────────────────────────────────────────────────

export async function callTelegram(method: string, body?: Record<string, unknown>): Promise<unknown> {
  const url = `${TELEGRAM_API}${botToken}/${method}`
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10_000),
      })
      const data = await res.json() as { ok: boolean; result?: unknown; description?: string }
      if (data.ok) return data.result
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, RETRY_BASE_MS * Math.pow(2, attempt)))
        continue
      }
      throw new Error(`Telegram API error: ${data.description}`)
    } catch (err) {
      if (attempt === MAX_RETRIES - 1) throw err
      await new Promise(r => setTimeout(r, RETRY_BASE_MS * Math.pow(2, attempt)))
    }
  }
}

// ─── API Data Fetching ───────────────────────────────────────

export const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4400'

export async function fetchApi<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return null
    const json = await res.json() as { data?: T }
    return json.data ?? null
  } catch {
    return null
  }
}

export function fmtUsd(n: number): string {
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

export function fmtPrice(n: number): string {
  if (n >= 1000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  if (n >= 1) return `$${n.toFixed(2)}`
  if (n >= 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(6)}`
}

// ─── Keyboard Builders ───────────────────────────────────────

export interface Button { text: string; callback_data?: string; url?: string }

export function keyboard(rows: Button[][]): { inline_keyboard: Button[][] } {
  return { inline_keyboard: rows }
}

export function setBotToken(t: string): void { botToken = t }
export function setPollingOffset(n: number): void { pollingOffset = n }
export function setPolling(v: boolean): void { isPolling = v }

export interface TgMessage {
  text?: string
  chat: { id: number }
  message_id?: number
  from?: { id: number; username?: string }
}

export interface TgCallbackQuery {
  data?: string
  message?: { chat: { id: number }; message_id?: number }
  id: string
}
