import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callTelegram, registeredChats, type TgCallbackQuery, type TgMessage } from '../core'
import { handleCallback, handleMessage } from '../handlers'
import { MAIN_MENU, MENU_MAP } from '../menus'
import { subscribeSignals, unsubscribeSignalsWithStatus } from '../signal-publisher'

vi.mock('../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core')>()
  return {
    ...actual,
    callTelegram: vi.fn().mockResolvedValue({ ok: true }),
    fetchApi: vi.fn().mockResolvedValue(null),
  }
})

vi.mock('../formatters', () => ({
  formatFearGreed: vi.fn().mockResolvedValue('data'),
  formatPrices: vi.fn().mockResolvedValue('data'),
  formatExchangeFlow: vi.fn().mockResolvedValue('data'),
  formatWhaleClusters: vi.fn().mockResolvedValue('data'),
  formatMempool: vi.fn().mockResolvedValue('data'),
  formatInsider: vi.fn().mockResolvedValue('data'),
  formatDerivatives: vi.fn().mockResolvedValue('data'),
  formatLiquidations: vi.fn().mockResolvedValue('data'),
  formatGas: vi.fn().mockResolvedValue('data'),
  formatSmartMoney: vi.fn().mockResolvedValue('data'),
  formatNews: vi.fn().mockResolvedValue('data'),
  formatWeather: vi.fn().mockResolvedValue('data'),
  formatStatus: vi.fn().mockResolvedValue('data'),
  formatTokens: vi.fn().mockResolvedValue('data'),
  formatSectors: vi.fn().mockResolvedValue('data'),
  formatMacro: vi.fn().mockResolvedValue('data'),
  formatStablecoins: vi.fn().mockResolvedValue('data'),
  formatTokenCheck: vi.fn().mockResolvedValue('data'),
  formatTopMeme: vi.fn().mockResolvedValue('data'),
  formatSniperScan: vi.fn().mockResolvedValue('data'),
}))

vi.mock('../signal-publisher', () => ({
  subscribeSignals: vi.fn(() => true),
  unsubscribeSignalsWithStatus: vi.fn(() => ({ persisted: true, wasSubscribed: true })),
}))

function message(text: string): TgMessage {
  return { text, chat: { id: 42 }, message_id: 1 }
}

function callback(data?: string, withMessage = true): TgCallbackQuery {
  return {
    id: 'query-id',
    data,
    ...(withMessage ? { message: { chat: { id: 42 }, message_id: 7 } } : {}),
  }
}

function answerCount(): number {
  return vi.mocked(callTelegram).mock.calls.filter(([method]) => method === 'answerCallbackQuery').length
}

describe('Telegram callback and subscription regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registeredChats.clear()
  })

  it('/stop removes both alert registration and the durable signal subscription', async () => {
    registeredChats.add('42')

    await handleMessage(message('/stop'))

    expect(registeredChats.has('42')).toBe(false)
    expect(unsubscribeSignalsWithStatus).toHaveBeenCalledOnce()
    expect(unsubscribeSignalsWithStatus).toHaveBeenCalledWith('42')
    expect(callTelegram).toHaveBeenCalledWith('sendMessage', expect.objectContaining({
      text: expect.stringContaining('Signal broadcasts stopped'),
    }))
  })

  it('/stop reports storage failure instead of claiming signals stopped', async () => {
    vi.mocked(unsubscribeSignalsWithStatus).mockReturnValueOnce({ persisted: false, wasSubscribed: false })

    await handleMessage(message('/stop'))

    expect(callTelegram).toHaveBeenCalledWith('sendMessage', expect.objectContaining({
      text: expect.stringContaining('storage is unavailable'),
    }))
  })

  it('answers every callback emitted by every menu exactly once', async () => {
    const callbacks = Object.values(MENU_MAP).flatMap(menu =>
      menu.inline_keyboard.flat().flatMap(button => button.callback_data ? [button.callback_data] : []),
    )
    expect(callbacks.length).toBeGreaterThan(20)

    for (const data of new Set(callbacks)) {
      vi.mocked(callTelegram).mockClear()
      await handleCallback(callback(data))
      expect(answerCount(), data).toBe(1)
      expect(callTelegram).toHaveBeenCalledWith('answerCallbackQuery', expect.objectContaining({
        callback_query_id: 'query-id',
      }))
    }
  })

  it.each(['unknown:value', 'menu:missing', 'data:missing', 'act:missing'])(
    'answers unknown callback %s exactly once',
    async (data) => {
      await handleCallback(callback(data))
      expect(answerCount()).toBe(1)
      expect(callTelegram).toHaveBeenCalledWith('answerCallbackQuery', {
        callback_query_id: 'query-id',
        text: 'Unknown callback',
      })
    },
  )

  it('answers callbacks with missing data or message exactly once', async () => {
    for (const query of [callback(undefined), callback('menu:main', false)]) {
      vi.mocked(callTelegram).mockClear()
      await handleCallback(query)
      expect(answerCount()).toBe(1)
    }
  })

  it('exposes a reachable Safety menu from the main menu', async () => {
    const safetyButton = MAIN_MENU.inline_keyboard.flat().find(button => button.callback_data === 'menu:safety')
    expect(safetyButton).toBeDefined()
    expect(MENU_MAP.safety).toBeDefined()

    await handleCallback(callback('menu:safety'))

    expect(callTelegram).toHaveBeenCalledWith('editMessageText', expect.objectContaining({
      reply_markup: MENU_MAP.safety,
    }))
    expect(answerCount()).toBe(1)
  })

  it('does not report callback subscription success when persistence fails', async () => {
    vi.mocked(subscribeSignals).mockReturnValueOnce(false)

    await handleCallback(callback('act:signal-sub'))

    expect(callTelegram).toHaveBeenCalledWith('sendMessage', expect.objectContaining({
      text: expect.stringContaining('Signal Subscription Failed'),
    }))
    expect(answerCount()).toBe(1)
  })
})
