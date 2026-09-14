// NEXUS Telegram Bot — thin facade: polling + public API, barrel re-export.

import { registeredChats, botToken, isPolling, pollingOffset, startTime, setBotToken, setPollingOffset, setPolling, callTelegram, type TgMessage, type TgCallbackQuery } from './core'
import { handleMessage, handleCallback } from './handlers'

async function pollUpdates(): Promise<void> {
  if (!botToken || isPolling) return
  setPolling(true)

  while (isPolling) {
    try {
      const updates = await callTelegram('getUpdates', {
        offset: pollingOffset,
        timeout: 30,
        allowed_updates: ['message', 'callback_query'],
      }) as Array<{
        update_id: number
        message?: TgMessage
        callback_query?: TgCallbackQuery
      }> | undefined

      if (updates?.length) {
        for (const update of updates) {
          setPollingOffset(update.update_id + 1)
          if (update.message) await handleMessage(update.message)
          if (update.callback_query) await handleCallback(update.callback_query)
        }
      }
    } catch {
      await new Promise(r => setTimeout(r, 5000))
    }
  }
}

export function initTelegramBot(token?: string): void {
  setBotToken(token || process.env.TELEGRAM_BOT_TOKEN || '')
  if (!botToken) {
    console.warn('[Telegram] No TELEGRAM_BOT_TOKEN set — bot disabled')
    return
  }
  console.log('[Telegram] Bot initialized, starting polling...')
  void pollUpdates()
}

export async function sendTelegramAlert(chatId: string, message: string): Promise<boolean> {
  if (!botToken) return false
  try {
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown',
    })
    return true
  } catch (err) {
    console.error(`[Telegram] Failed to send alert to ${chatId}:`, (err as Error).message)
    return false
  }
}

export async function broadcastAlert(message: string): Promise<{ sent: number; failed: number }> {
  let sent = 0
  let failed = 0
  for (const chatId of registeredChats) {
    const ok = await sendTelegramAlert(chatId, message)
    if (ok) sent++
    else failed++
  }
  return { sent, failed }
}

export function registerChat(chatId: string): void {
  registeredChats.add(chatId)
}

export function unregisterChat(chatId: string): void {
  registeredChats.delete(chatId)
}

export function getRegisteredChats(): string[] {
  return Array.from(registeredChats)
}

export function getBotStatus(): { enabled: boolean; chatCount: number; polling: boolean; uptime: number } {
  return {
    enabled: !!botToken,
    chatCount: registeredChats.size,
    polling: isPolling,
    uptime: (Date.now() - startTime) / 1000,
  }
}

export function stopPolling(): void {
  setPolling(false)
}

export * from './core'
export * from './menus'
export * from './formatters'
export * from './handlers'
