// ─────────────────────────────────────────────────────────────
// Telegram Signal Publisher — Orchestrates signal broadcast
// Tracks subscribers, deduplicates broadcasts, calls Telegram API
// ─────────────────────────────────────────────────────────────

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getAlphaSignals } from '@/lib/modules/derived/alpha-engine'
import { formatSignalMessage } from './signal-formatter'

interface PublisherState {
  subscribers: string[]
  broadcastedSignals: string[]
}

const MAX_BROADCASTED = 500
const MIN_BROADCAST_CONFIDENCE = 65
const LOCK_TIMEOUT_MS = 5_000
const STALE_LOCK_MS = 30_000

function statePath(): string {
  return process.env.TELEGRAM_SIGNAL_STATE_PATH || join(process.cwd(), 'data', 'telegram-signal-state.json')
}

function readState(path: string): PublisherState {
  if (!existsSync(path)) return { subscribers: [], broadcastedSignals: [] }
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<PublisherState>
  return {
    subscribers: Array.isArray(raw.subscribers)
      ? [...new Set(raw.subscribers.filter((id): id is string => typeof id === 'string'))]
      : [],
    broadcastedSignals: Array.isArray(raw.broadcastedSignals)
      ? [...new Set(raw.broadcastedSignals.filter((id): id is string => typeof id === 'string'))].slice(-MAX_BROADCASTED)
      : [],
  }
}

function writeState(path: string, state: PublisherState): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  let fd: number | undefined
  try {
    fd = openSync(tmp, 'wx', 0o600)
    writeFileSync(fd, JSON.stringify(state))
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(tmp, path)
    const dir = openSync(dirname(path), 'r')
    try { fsyncSync(dir) } finally { closeSync(dir) }
  } finally {
    if (fd !== undefined) closeSync(fd)
    try { unlinkSync(tmp) } catch { /* renamed or never created */ }
  }
}

/** Serialize disk read/modify/rename across PM2 workers. */
function updateState<T>(update: (state: PublisherState) => { state: PublisherState; result: T }): T {
  const path = statePath()
  mkdirSync(dirname(path), { recursive: true })
  const lockPath = `${path}.lock`
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  let fd: number | undefined
  while (fd === undefined) {
    try {
      fd = openSync(lockPath, 'wx', 0o600)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      try {
        const pid = Number(readFileSync(lockPath, 'utf8'))
        let alive = false
        if (Number.isInteger(pid) && pid > 0) {
          try { process.kill(pid, 0); alive = true } catch { /* stale worker */ }
        }
        if (!alive && Date.now() - statSync(lockPath).mtimeMs > STALE_LOCK_MS) unlinkSync(lockPath)
      } catch { /* lock changed while inspecting it */ }
      if (Date.now() >= deadline) throw new Error('Timed out waiting for signal publisher state lock')
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
    }
  }
  try {
    writeFileSync(fd, String(process.pid))
  } catch (err) {
    closeSync(fd)
    try { unlinkSync(lockPath) } catch { /* already gone */ }
    throw err
  }
  try {
    const next = update(readState(path))
    writeState(path, next.state)
    return next.result
  } finally {
    closeSync(fd)
    try { unlinkSync(lockPath) } catch { /* lock already reclaimed */ }
  }
}

// ─── Subscription Management ─────────────────────────────────
export function subscribeSignals(chatId: string): boolean {
  try {
    return updateState(state => {
      if (state.subscribers.includes(chatId)) return { state, result: true }
      return { state: { ...state, subscribers: [...state.subscribers, chatId] }, result: true }
    })
  } catch (err) {
    console.error('[SignalPublisher] Storage error:', (err as Error).message)
    return false
  }
}

export interface SignalUnsubscribeResult {
  /** False when the removal could not be written to disk. */
  persisted: boolean
  /** True when this chat actually held a subscription. */
  wasSubscribed: boolean
}

export function unsubscribeSignals(chatId: string): boolean {
  return unsubscribeSignalsWithStatus(chatId).wasSubscribed
}

export function unsubscribeSignalsWithStatus(chatId: string): SignalUnsubscribeResult {
  try {
    return updateState(state => ({
      state: { ...state, subscribers: state.subscribers.filter(id => id !== chatId) },
      result: { persisted: true, wasSubscribed: state.subscribers.includes(chatId) },
    }))
  } catch (err) {
    console.error('[SignalPublisher] Storage error:', (err as Error).message)
    return { persisted: false, wasSubscribed: false }
  }
}

export function isSubscribedToSignals(chatId: string): boolean {
  try {
    return readState(statePath()).subscribers.includes(chatId)
  } catch (err) {
    console.error('[SignalPublisher] Storage error:', (err as Error).message)
    return false
  }
}

export function getSignalSubscriberCount(): number {
  try {
    return readState(statePath()).subscribers.length
  } catch (err) {
    console.error('[SignalPublisher] Storage error:', (err as Error).message)
    return 0
  }
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
    const broadcast = updateState(state => {
      const seen = new Set(state.broadcastedSignals)
      const newSignals = result.signals.filter(s => s.confidence >= MIN_BROADCAST_CONFIDENCE && !seen.has(s.id))
      if (!newSignals.length) return { state, result: { newSignals, subscribers: state.subscribers } }
      for (const signal of newSignals) seen.add(signal.id)
      return {
        state: { ...state, broadcastedSignals: [...seen].slice(-MAX_BROADCASTED) },
        result: { newSignals, subscribers: state.subscribers },
      }
    })

    let totalSent = 0
    let totalFailed = 0
    for (const signal of broadcast.newSignals) {
      const message = formatSignalMessage(signal)
      for (const chatId of broadcast.subscribers) {
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
      newSignals: broadcast.newSignals.length,
      broadcastTo: broadcast.newSignals.length ? broadcast.subscribers.length : 0,
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
