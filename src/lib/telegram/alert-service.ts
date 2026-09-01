// ─────────────────────────────────────────────────────────────
// NEXUS Telegram Alert Service — per-user link + alert delivery
// Links an app User to a Telegram chat and sends personal alerts
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'
import { initTelegramBot, sendTelegramAlert } from './bot'

let botEnsured = false

/** Lazily ensure the bot token is initialized so sendTelegramAlert works in any server instance. */
function ensureBot(): void {
  if (!botEnsured && process.env.TELEGRAM_BOT_TOKEN) {
    botEnsured = true
    initTelegramBot()
  }
}

/**
 * Link an app User to a Telegram chat (and optional username).
 * Persists telegramChatId + telegramUsername on the User row.
 */
export async function linkTelegram(
  userId: string,
  chatId: string,
  username?: string | null,
): Promise<{ linked: boolean }> {
  if (!userId || !chatId) return { linked: false }
  ensureBot()
  try {
    const data: { telegramChatId: string; telegramUsername?: string } = {
      telegramChatId: String(chatId),
    }
    if (username) data.telegramUsername = String(username)
    await prisma.user.update({ where: { id: userId }, data })
    return { linked: true }
  } catch (err) {
    console.error('[TelegramAlert] linkTelegram failed:', (err as Error).message)
    return { linked: false }
  }
}

/**
 * Bot-side link: resolve an app User by Telegram username, then store the chat.
 * Used when the bot /start or /sub receives a Telegram username matching a known app user.
 */
export async function linkTelegramByUsername(
  telegramUsername: string,
  chatId: string,
): Promise<boolean> {
  if (!telegramUsername || !chatId) return false
  try {
    const user = await prisma.user.findFirst({
      where: { telegramUsername },
      select: { id: true },
    })
    if (!user) return false
    const res = await linkTelegram(user.id, chatId, telegramUsername)
    return res.linked
  } catch {
    return false
  }
}

/**
 * Send a personal Telegram alert to a user's linked chat.
 * Returns sent:true if the user has a chat and delivery succeeded.
 */
export async function sendUserAlert(
  userId: string,
  message: string,
): Promise<{ sent: boolean }> {
  if (!userId || !message) return { sent: false }
  ensureBot()
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { telegramChatId: true },
    })
    if (!user?.telegramChatId) return { sent: false }
    const ok = await sendTelegramAlert(user.telegramChatId, message)
    return { sent: ok }
  } catch (err) {
    console.error('[TelegramAlert] sendUserAlert failed:', (err as Error).message)
    return { sent: false }
  }
}

/** Count app users who have linked a Telegram chat. */
export async function getSubscriberCountUser(): Promise<number> {
  try {
    return await prisma.user.count({ where: { telegramChatId: { not: null } } })
  } catch {
    return 0
  }
}
