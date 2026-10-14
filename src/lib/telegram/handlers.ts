// NEXUS Telegram Bot — callback/data handlers per domain.

import { callTelegram, fetchApi, fmtUsd, keyboard, registeredChats, type TgMessage, type TgCallbackQuery } from './core'
import { BACK_ROW, MAIN_MENU, MENU_MAP } from './menus'
import { formatFearGreed, formatPrices, formatExchangeFlow, formatWhaleClusters, formatMempool, formatInsider, formatDerivatives, formatLiquidations, formatGas, formatSmartMoney, formatNews, formatWeather, formatStatus, formatTokens, formatSectors, formatMacro, formatStablecoins, formatTokenCheck, formatTopMeme, formatSniperScan } from './formatters'

export type DataHandler = () => Promise<string>

export const DATA_HANDLERS: Record<string, DataHandler> = {
  'fear-greed': formatFearGreed,
  'prices': formatPrices,
  'sectors': formatSectors,
  'macro': formatMacro,
  'top': formatTopMeme,
  'meme-top': formatTopMeme,
  'scan': formatSniperScan,
  'sniper-scan': formatSniperScan,
  'correlations': async () => {
    const d = await fetchApi<Array<Record<string, unknown>>>('/api/v1/correlations')
    if (!d?.length) return '📊 *Correlations*\n\nNo correlation data available'
    const lines = ['📊 *Correlations*', '']
    for (const c of d.slice(0, 6)) {
      const pair = String(c.pair ?? '?')
      const corr = typeof c.correlation === 'number' ? c.correlation : 0
      const sig = String(c.significance ?? '?')
      lines.push(`• *${pair}*: ${corr.toFixed(3)} (${sig})`)
    }
    return lines.join('\n')
  },
  'forex': async () => {
    const d = await fetchApi<Record<string, unknown>>('/api/v1/macro?category=forex')
    return d ? '💱 *Forex*\n\nSee /macro for forex data' : '❌ No forex data'
  },
  'equities': async () => {
    const d = await fetchApi<Record<string, unknown>>('/api/v1/macro?category=equities')
    return d ? '🏦 *Equities*\n\nSee /macro for equity data' : '❌ No equity data'
  },
  'commodities': async () => {
    const d = await fetchApi<Record<string, unknown>>('/api/v1/macro?category=commodities')
    return d ? '🌾 *Commodities*\n\nSee /macro for commodity data' : '❌ No commodity data'
  },
  'whale-cluster': formatWhaleClusters,
  'exchange-flow': formatExchangeFlow,
  'mempool': formatMempool,
  'insider': formatInsider,
  'entities': async () => {
    const d = await fetchApi<Array<Record<string, unknown>>>('/api/v1/entities')
    if (!d?.length) return '🏦 *Entities*\n\nNo entities data'
    const lines = ['🏦 *Top Entities*', '']
    for (const e of d.slice(0, 6)) {
      const name = String(e.name ?? '?')
      const type = String(e.type ?? '?')
      const value = (e.totalUsdValue as number) ?? 0
      lines.push(`• *${name}* (${type}) — ${fmtUsd(value)}`)
    }
    return lines.join('\n')
  },
  'derivatives': formatDerivatives,
  'liquidations': formatLiquidations,
  'dex': async () => {
    const d = await fetchApi<Record<string, unknown>>('/api/v1/exchanges?limit=5')
    if (!d) return '❌ Failed to fetch DEX data'
    const lines = ['🔄 *DEX Monitor*', '']
    for (const [ex, tickers] of Object.entries(d)) {
      if (Array.isArray(tickers) && tickers.length) {
        lines.push(`*${ex.toUpperCase()}*: ${tickers.length} pairs`)
      }
    }
    return lines.join('\n')
  },
  'scanner': async () => {
    const d = await fetchApi<Record<string, unknown>>('/api/v1/derivatives?limit=10')
    if (!d) return '❌ Failed to fetch scanner data'
    const pairs = (d.topPairs as Array<Record<string, unknown>>) ?? []
    const lines = ['📡 *New Pairs Scanner*', '', `${pairs.length} pairs tracked`, '']
    for (const p of pairs.slice(0, 6)) {
      const sym = String(p.symbol ?? '?')
      const vol = typeof p.volume24h === 'number' ? p.volume24h : 0
      lines.push(`• *${sym}* Vol: ${fmtUsd(vol)}`)
    }
    return lines.join('\n')
  },
  'tokens': formatTokens,
  'smart-money': formatSmartMoney,
  'copy-trade': async () => {
    const d = await fetchApi<Array<Record<string, unknown>>>('/api/v1/copy-trade')
    if (!d?.length) return '📋 *Copy Trades*\n\nNo copy trade signals'
    const lines = ['📋 *Copy Trade Signals*', '']
    for (const s of d.slice(0, 5)) {
      const token = String(s.token ?? s.symbol ?? '?')
      const value = (s.valueUsd as number) ?? 0
      lines.push(`• *${token}* — ${fmtUsd(value)}`)
    }
    return lines.join('\n')
  },
  'edge-report': async () => {
    const d = await fetchApi<Record<string, unknown>>('/api/v1/edge-report')
    if (!d) return '📈 *Edge Report*\n\nNo report available'
    return `📈 *Edge Report*\n\n${JSON.stringify(d).slice(0, 500)}`
  },
  'signal-confidence': async () => {
    const d = await fetchApi<Record<string, unknown>>('/api/v1/signal-confidence')
    if (!d) return '📊 *Signal Confidence*\n\nNo data'
    return `📊 *Signal Confidence*\n\n${JSON.stringify(d).slice(0, 500)}`
  },
  'signals': async () => {
    const d = await fetchApi<Record<string, unknown>>('/api/v1/alpha-engine')
    if (!d) return '📡 *No active signals*\n\nNo signals currently.'
    const signals = (d.signals ?? []) as Array<Record<string, unknown>>
    if (!Array.isArray(signals) || !signals.length) return '📡 *No active signals*\n\nNo signals currently.'
    const lines = ['📡 *Active Signals* — ' + signals.length + ' found', '']
    for (const s of signals.slice(0, 10)) {
      const dir = String(s.direction ?? 'neutral')
      const emoji = dir === 'bullish' ? '🟢' : dir === 'bearish' ? '🔴' : '⚪'
      const remaining = Math.max(0, Math.round(((s.expiresAt as number) - Date.now()) / 3_600_000))
      lines.push(emoji + ' *' + s.symbol + '* ' + dir.toUpperCase() + ' ' + s.confidence + '% (' + remaining + 'h)')
      lines.push('   ' + String(s.reasoning ?? '').slice(0, 80))
      if (s.entry != null) lines.push('   Entry: $' + Number(s.entry).toFixed(2))
      lines.push('')
    }
    return lines.join('\n')
  },
  'gas': formatGas,
  'mempool-stats': formatMempool,
  'stablecoins': formatStablecoins,
  'defi-tvl': async () => {
    const d = await fetchApi<Record<string, unknown>>('/api/v1/defi/tvl')
    if (!d) return '📊 *DeFi TVL*\n\nNo data'
    return `📊 *DeFi TVL*\n\nTotal: *${fmtUsd((d.totalTvl as number) ?? 0)}*`
  },
  'defi-yields': async () => {
    const d = await fetchApi<Record<string, unknown>>('/api/v1/defi/yields')
    if (!d) return '💰 *DeFi Yields*\n\nNo data'
    return `💰 *DeFi Yields*\n\n${JSON.stringify(d).slice(0, 500)}`
  },
  'status': formatStatus,
  'news': formatNews,
  'weather': formatWeather,
  'alt-data': async () => {
    const d = await fetchApi<Record<string, unknown>>('/api/v1/alt-data')
    if (!d) return '📊 *Alt Data*\n\nNo data'
    return `📊 *Alt Data*\n\n${JSON.stringify(d).slice(0, 500)}`
  },
  'feeds': async () => {
    const d = await fetchApi<Record<string, unknown>>('/api/v1/feeds')
    if (!d) return '📰 *Feed Sources*\n\nNo data'
    return `📰 *Feed Sources*\n\nActive sources configured`
  },
  'alerts': async () => {
    const d = await fetchApi<Record<string, unknown>>('/api/v1/alerts')
    if (!d) return '🔔 *Alerts*\n\nNo alerts configured. Create one via web.'
    return `🔔 *Alerts*\n\n${JSON.stringify(d).slice(0, 500)}`
  },
  'alert-templates': async () => {
    const d = await fetchApi<Array<Record<string, unknown>>>('/api/v1/alerts/templates')
    if (!d?.length) return '📋 *Alert Templates*\n\nNo templates available'
    const lines = ['📋 *Alert Templates*', '']
    for (const t of d.slice(0, 5)) {
      lines.push(`• *${String(t.name ?? '?')}* — ${String(t.description ?? '').slice(0, 50)}`)
    }
    return lines.join('\n')
  },
}

export function formatHelpText(): string {
  return [
    '❓ *NEXUS Bot Help*',
    '',
    'Commands:',
    '• /check `<address>` — Audit token security & rug risk',
    '• /top — Top trending meme tokens',
    '• /scan — Meme sniper scan status & radar',
    '• /sub — Subscribe to high-confidence signals',
    '• /stop — Unregister from alerts',
    '• /help — Show this help message',
    '',
    '💡 *Tip:* Paste any Solana or EVM token address directly into this chat to run a safety audit immediately!',
    '',
    'Categories:',
    '• 📊 Market — prices, fear/greed, sectors, macro',
    '• 🐋 Whale — clusters, exchange flows, mempool, insider',
    '• 💹 Trading — derivatives, liquidations, DEX, scanner',
    '• 🧠 Smart Money — top wallets, copy trades, signals',
    '• ⛽ Network — gas, stablecoins, DeFi',
    '• 🛡 Safety — rugcheck, system status',
    '• 📰 Intel — news, weather, alt data',
    '• 🔔 Alerts — manage your alert rules',
    '',
    'Send /start anytime to return to the main menu.',
  ].join('\n')
}

export async function handleMessage(msg: TgMessage): Promise<void> {
  const chatId = String(msg.chat.id)
  const rawText = (msg.text ?? '').trim()
  const lower = rawText.toLowerCase()
  const command = lower.split(/\s+/)[0].replace(/@\w+$/, '')

  // /start and /sub both register the chat AND attempt to link it to an app user
  // via a matching Telegram username (persisted by linkTelegram on the web side).
  if (command === '/start' || command === '/sub') {
    registeredChats.add(chatId)
    if (msg.from?.username) {
      try {
        const alert = await import('./alert-service')
        await alert.linkTelegramByUsername(msg.from.username, chatId)
      } catch {
        // Non-fatal — linking is best-effort.
      }
    }
    if (command === '/sub') {
      const sub = await import('./signal-publisher')
      sub.subscribeSignals(chatId)
    }
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: command === '/sub'
        ? '🔔 *Signal Subscription Active*\n\nYou\'ll now receive high-confidence signals automatically as they\'re generated.'
        : '🔔 *NEXUS Intelligence Terminal*\n\nWelcome! Tap a button to explore:',
      parse_mode: 'Markdown',
      reply_markup: MAIN_MENU,
    })
    return
  }

  if (command === '/stop') {
    registeredChats.delete(chatId)
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: '🔕 Unregistered from alerts. Send /start to re-enable.',
    })
    return
  }

  if (command === '/help' || lower === 'help') {
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: formatHelpText(),
      parse_mode: 'Markdown',
      reply_markup: keyboard([BACK_ROW]),
    })
    return
  }

  if (command === '/check') {
    const target = rawText.replace(/^\/check(@\w+)?/i, '').trim()
    if (target) {
      const text = await formatTokenCheck(target)
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        reply_markup: keyboard([BACK_ROW]),
      })
      return
    }
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: '🛡 *Token Safety Check*\n\nPlease specify a token contract address:\nExample: `/check <address>`\nOr simply paste the address directly into this chat.',
      parse_mode: 'Markdown',
    })
    return
  }

  if (command === '/top') {
    const text = await formatTopMeme()
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup: keyboard([BACK_ROW]),
    })
    return
  }

  if (command === '/scan') {
    const text = await formatSniperScan()
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup: keyboard([BACK_ROW]),
    })
    return
  }

  // Automatic Address Detection (Text Routing):
  // If the message is NOT a slash command, test if text (or first word) matches
  // Solana Base58 regex or EVM regex.
  if (!rawText.startsWith('/')) {
    const firstWord = rawText.split(/\s+/)[0]
    const SOLANA_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
    const EVM_REGEX = /^0x[a-fA-F0-9]{40}$/

    let matchedAddress: string | null = null
    if (SOLANA_REGEX.test(rawText) || EVM_REGEX.test(rawText)) {
      matchedAddress = rawText
    } else if (SOLANA_REGEX.test(firstWord) || EVM_REGEX.test(firstWord)) {
      matchedAddress = firstWord
    }

    if (matchedAddress) {
      const text = await formatTokenCheck(matchedAddress)
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        reply_markup: keyboard([BACK_ROW]),
      })
      return
    }
  }

  // Default: show main menu
  await callTelegram('sendMessage', {
    chat_id: chatId,
    text: '🔔 *NEXUS Intelligence Terminal*\n\nChoose a category:',
    parse_mode: 'Markdown',
    reply_markup: MAIN_MENU,
  })
}

export async function handleCallback(cb: TgCallbackQuery): Promise<void> {
  if (!cb.data || !cb.message) return
  const chatId = String(cb.message.chat.id)
  const msgId = cb.message.message_id
  const [action, param] = cb.data.split(':')

  try {
    if (action === 'menu') {
      const menu = MENU_MAP[param]
      if (menu) {
        await callTelegram('editMessageText', {
          chat_id: chatId,
          message_id: msgId,
          text: param === 'main' ? '🔔 *NEXUS Intelligence Terminal*\n\nChoose a category:' : `📂 *${param.charAt(0).toUpperCase() + param.slice(1)}*\n\nSelect a feature:`,
          parse_mode: 'Markdown',
          reply_markup: menu,
        })
      }
    } else if (action === 'data') {
      const handler = DATA_HANDLERS[param]
      if (handler) {
        await callTelegram('answerCallbackQuery', { callback_query_id: cb.id, text: 'Loading...' })
        const text = await handler()
        await callTelegram('editMessageText', {
          chat_id: chatId,
          message_id: msgId,
          text,
          parse_mode: 'Markdown',
          reply_markup: keyboard([BACK_ROW]),
        })
      }
    } else if (action === 'act') {
      if (param === 'status') {
        await callTelegram('answerCallbackQuery', { callback_query_id: cb.id, text: 'Loading status...' })
        const text = await formatStatus()
        await callTelegram('editMessageText', {
          chat_id: chatId,
          message_id: msgId,
          text,
          parse_mode: 'Markdown',
          reply_markup: keyboard([BACK_ROW]),
        })
      } else if (param === 'help') {
        await callTelegram('editMessageText', {
          chat_id: chatId,
          message_id: msgId,
          text: formatHelpText(),
          parse_mode: 'Markdown',
          reply_markup: keyboard([BACK_ROW]),
        })
      } else if (param === 'rugcheck') {
        await callTelegram('answerCallbackQuery', { callback_query_id: cb.id, text: 'Paste an address to audit.' })
        await callTelegram('sendMessage', {
          chat_id: chatId,
          text: '🛡 *RugCheck & Token Security*\n\nPaste any Solana (Base58) or EVM (0x...) token contract address directly into this chat to check safety.\n\nExample:\n• Solana: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`\n• EVM: `0xdac17f958d2ee523a2206206994597c13d831ec7`\n\nOr use `/check <address>`',
          parse_mode: 'Markdown',
          reply_markup: keyboard([BACK_ROW]),
        })
      } else if (param === 'token-search') {
        await callTelegram('sendMessage', {
          chat_id: chatId,
          text: '🔍 *Token Search & Security*\n\nPaste a token contract address directly into this chat to run an instant security audit.\n\nYou can also use `/check <address>` or view trending tokens with `/top`.',
          parse_mode: 'Markdown',
          reply_markup: keyboard([BACK_ROW]),
        })
      } else if (param === 'create-alert') {
        await callTelegram('sendMessage', {
          chat_id: chatId,
          text: '➕ *Create Alert*\n\nUse the web dashboard at tracker.aitradepulse.com/alerts to create custom alert rules.',
          parse_mode: 'Markdown',
          reply_markup: keyboard([[{ text: '🌐 Open Dashboard', url: 'https://tracker.aitradepulse.com/alerts' }], BACK_ROW]),
        })
      } else if (param === 'signal-sub') {
        const sub = await import('./signal-publisher')
        sub.subscribeSignals(chatId)
        await callTelegram('answerCallbackQuery', { callback_query_id: cb.id, text: '✅ Subscribed!' })
        await callTelegram('sendMessage', {
          chat_id: chatId,
          text: '🔔 *Signal Subscription Active*\n\nYou\'ll now receive high-confidence signals automatically as they\'re generated.',
          parse_mode: 'Markdown',
        })
      } else if (param === 'signal-unsub') {
        const sub = await import('./signal-publisher')
        sub.unsubscribeSignals(chatId)
        await callTelegram('answerCallbackQuery', { callback_query_id: cb.id, text: '🔕 Unsubscribed.' })
        await callTelegram('sendMessage', {
          chat_id: chatId,
          text: '🔕 *Signal Subscription Cancelled*\n\nYou will no longer receive automatic signal broadcasts.',
          parse_mode: 'Markdown',
        })
      }
    }
  } catch (err) {
    console.error('[Telegram] Callback error:', (err as Error).message)
    await callTelegram('answerCallbackQuery', { callback_query_id: cb.id, text: 'Error loading data' }).catch(() => {})
  }
}
