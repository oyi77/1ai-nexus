import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TgMessage, TgCallbackQuery } from '../core'
import { callTelegram, registeredChats } from '../core'
import { handleMessage, handleCallback, formatHelpText } from '../handlers'
import { formatTokenCheck, formatTopMeme, formatSniperScan } from '../formatters'
import { auditRugcheckToken } from '@/lib/modules/meme/rugcheck'
import type { MemeRiskAudit } from '@/lib/modules/meme/types'

vi.mock('../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core')>()
  return {
    ...actual,
    callTelegram: vi.fn().mockResolvedValue({ ok: true }),
    fetchApi: vi.fn().mockResolvedValue(null),
  }
})

vi.mock('@/lib/modules/meme/rugcheck', () => ({
  auditRugcheckToken: vi.fn(),
}))

vi.mock('@/lib/modules/derived/sniper-log', () => ({
  readSniperLog: vi.fn().mockReturnValue({ entries: [], updatedAt: null, lastScan: null }),
  sniperLogCounts: vi.fn().mockReturnValue({ SIGNAL: 0, WATCHLIST: 0, REJECT: 0, total: 0 }),
}))

const SOLANA_SAMPLE = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const EVM_SAMPLE = '0xdac17f958d2ee523a2206206994597c13d831ec7'

function makeMsg(text: string, id = 99999): TgMessage {
  return {
    text,
    chat: { id },
    message_id: 1,
    from: { id, username: 'testuser' },
  }
}

function makeCallback(data: string, id = 99999): TgCallbackQuery {
  return {
    id: 'cb_123',
    data,
    message: { chat: { id }, message_id: 42 },
  }
}

describe('Telegram Bot Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registeredChats.clear()
  })

  describe('handleMessage Command & Routing', () => {
    it('/start registers chat and sends main menu', async () => {
      await handleMessage(makeMsg('/start'))
      expect(registeredChats.has('99999')).toBe(true)
      expect(callTelegram).toHaveBeenCalledWith('sendMessage', expect.objectContaining({
        chat_id: '99999',
        text: expect.stringContaining('NEXUS Intelligence Terminal'),
        parse_mode: 'Markdown',
      }))
    })

    it('/sub registers chat and signal subscription', async () => {
      await handleMessage(makeMsg('/sub'))
      expect(registeredChats.has('99999')).toBe(true)
      expect(callTelegram).toHaveBeenCalledWith('sendMessage', expect.objectContaining({
        chat_id: '99999',
        text: expect.stringContaining('Signal Subscription Active'),
      }))
    })

    it('/stop unregisters chat', async () => {
      registeredChats.add('99999')
      await handleMessage(makeMsg('/stop'))
      expect(registeredChats.has('99999')).toBe(false)
      expect(callTelegram).toHaveBeenCalledWith('sendMessage', expect.objectContaining({
        chat_id: '99999',
        text: expect.stringContaining('Unregistered from alerts'),
      }))
    })

    it('/help and bare "help" send help text', async () => {
      await handleMessage(makeMsg('/help'))
      expect(callTelegram).toHaveBeenCalledWith('sendMessage', expect.objectContaining({
        chat_id: '99999',
        text: formatHelpText(),
        parse_mode: 'Markdown',
      }))

      vi.mocked(callTelegram).mockClear()
      await handleMessage(makeMsg('help'))
      expect(callTelegram).toHaveBeenCalledWith('sendMessage', expect.objectContaining({
        chat_id: '99999',
        text: formatHelpText(),
      }))
    })

    it('bare /check prompts for contract address', async () => {
      await handleMessage(makeMsg('/check'))
      expect(callTelegram).toHaveBeenCalledWith('sendMessage', expect.objectContaining({
        chat_id: '99999',
        text: expect.stringContaining('Please specify a token contract address'),
      }))
    })

    it('/check <address> calls formatTokenCheck and replies', async () => {
      const mockAudit: MemeRiskAudit = {
        id: `solana:${SOLANA_SAMPLE}`,
        platform: 'rugcheck',
        chain: 'solana',
        contract: SOLANA_SAMPLE,
        symbol: 'USDC',
        name: 'USD Coin',
        riskLevel: 0,
        riskLabel: 'safe',
        buyTax: 0,
        sellTax: 0,
        top10HolderPercent: 0.12,
        lpLockedPercent: 0.99,
        canFreeze: false,
        canMint: false,
        isHoneypot: false,
        riskCounts: { high: 0, middle: 0, low: 0 },
        auditedAt: Date.now(),
      }
      vi.mocked(auditRugcheckToken).mockResolvedValueOnce(mockAudit)

      await handleMessage(makeMsg(`/check ${SOLANA_SAMPLE}`))
      expect(callTelegram).toHaveBeenCalledWith('sendMessage', expect.objectContaining({
        chat_id: '99999',
        text: expect.stringContaining('PASSED SECURITY CHECKS'),
        parse_mode: 'Markdown',
      }))
    })

    it('bare Solana Base58 address automatically routes to formatTokenCheck', async () => {
      const mockAudit: MemeRiskAudit = {
        id: `solana:${SOLANA_SAMPLE}`,
        platform: 'rugcheck',
        chain: 'solana',
        contract: SOLANA_SAMPLE,
        symbol: 'BONK',
        name: 'Bonk',
        riskLevel: 1,
        riskLabel: 'low',
        buyTax: 0,
        sellTax: 0,
        top10HolderPercent: 0.18,
        lpLockedPercent: 0.85,
        canFreeze: false,
        canMint: false,
        isHoneypot: false,
        riskCounts: { high: 0, middle: 0, low: 1 },
        auditedAt: Date.now(),
      }
      vi.mocked(auditRugcheckToken).mockResolvedValueOnce(mockAudit)

      await handleMessage(makeMsg(SOLANA_SAMPLE))
      expect(callTelegram).toHaveBeenCalledWith('sendMessage', expect.objectContaining({
        chat_id: '99999',
        text: expect.stringContaining('Token Security Audit'),
      }))
    })

    it('bare EVM address automatically routes to formatTokenCheck', async () => {
      await handleMessage(makeMsg(EVM_SAMPLE))
      expect(callTelegram).toHaveBeenCalledWith('sendMessage', expect.objectContaining({
        chat_id: '99999',
        text: expect.stringMatching(/Token Security Audit|Security Audit Unavailable/),
      }))
    })

    it('/top routes to formatTopMeme', async () => {
      await handleMessage(makeMsg('/top'))
      expect(callTelegram).toHaveBeenCalledWith('sendMessage', expect.objectContaining({
        chat_id: '99999',
        text: expect.stringMatching(/Top Trending Tokens|No trending meme tokens/),
      }))
    })

    it('/scan routes to formatSniperScan', async () => {
      await handleMessage(makeMsg('/scan'))
      expect(callTelegram).toHaveBeenCalledWith('sendMessage', expect.objectContaining({
        chat_id: '99999',
        text: expect.stringMatching(/Sniper Radar/),
      }))
    })

    it('unrecognized text defaults to MAIN_MENU', async () => {
      await handleMessage(makeMsg('random chatter that is not an address'))
      expect(callTelegram).toHaveBeenCalledWith('sendMessage', expect.objectContaining({
        chat_id: '99999',
        text: expect.stringContaining('Choose a category:'),
      }))
    })
  })

  describe('formatTokenCheck', () => {
    it('returns friendly error for invalid address', async () => {
      const res = await formatTokenCheck('not-a-valid-crypto-address')
      expect(res).toContain('Invalid Token Contract')
      expect(res).toContain('not-a-valid-crypto-address')
    })

    it('formats safe verdict when clean', async () => {
      const mockAudit: MemeRiskAudit = {
        id: `solana:${SOLANA_SAMPLE}`,
        platform: 'rugcheck',
        chain: 'solana',
        contract: SOLANA_SAMPLE,
        symbol: 'SAFE',
        name: 'SafeCoin',
        riskLevel: 0,
        riskLabel: 'safe',
        buyTax: 0,
        sellTax: 0,
        top10HolderPercent: 0.15,
        lpLockedPercent: 0.95,
        canFreeze: false,
        canMint: false,
        isHoneypot: false,
        riskCounts: { high: 0, middle: 0, low: 0 },
        auditedAt: Date.now(),
      }
      vi.mocked(auditRugcheckToken).mockResolvedValueOnce(mockAudit)

      const res = await formatTokenCheck(SOLANA_SAMPLE)
      expect(res).toContain('🛡 *Token Security Audit*')
      expect(res).toContain('✅ *PASSED SECURITY CHECKS*')
      expect(res).toContain('SafeCoin')
      expect(res).toContain('Top 10 Holders: *15.0%*')
      expect(res).toContain('LP Locked: *95.0%*')
      expect(res).toContain('https://rugcheck.xyz/tokens/')
    })

    it('formats caution verdict when riskLevel 2 or top10 > 30% or canMint', async () => {
      const mockAudit: MemeRiskAudit = {
        id: `solana:${SOLANA_SAMPLE}`,
        platform: 'rugcheck',
        chain: 'solana',
        contract: SOLANA_SAMPLE,
        symbol: 'CAUT',
        name: 'CautionCoin',
        riskLevel: 1,
        riskLabel: 'low',
        buyTax: 0,
        sellTax: 0,
        top10HolderPercent: 0.45,
        lpLockedPercent: -1,
        canFreeze: false,
        canMint: true,
        isHoneypot: false,
        riskCounts: { high: 0, middle: 1, low: 0 },
        auditedAt: Date.now(),
      }
      vi.mocked(auditRugcheckToken).mockResolvedValueOnce(mockAudit)

      const res = await formatTokenCheck(SOLANA_SAMPLE)
      expect(res).toContain('⚠️ *CAUTION*')
      expect(res).toContain('Mint Authority: *Enabled ⚠️*')
      expect(res).toContain('Top 10 Holders: *45.0%*')
      expect(res).toContain('LP Locked: *Unknown*')
    })

    it('formats high risk verdict when honeypot or canFreeze or riskLevel >= 3', async () => {
      const mockAudit: MemeRiskAudit = {
        id: `solana:${SOLANA_SAMPLE}`,
        platform: 'rugcheck',
        chain: 'solana',
        contract: SOLANA_SAMPLE,
        symbol: 'RUG',
        name: 'RugCoin',
        riskLevel: 3,
        riskLabel: 'high',
        buyTax: 0.1,
        sellTax: 0.99,
        top10HolderPercent: 0.8,
        lpLockedPercent: 0,
        canFreeze: true,
        canMint: true,
        isHoneypot: true,
        riskCounts: { high: 3, middle: 1, low: 0 },
        auditedAt: Date.now(),
      }
      vi.mocked(auditRugcheckToken).mockResolvedValueOnce(mockAudit)

      const res = await formatTokenCheck(SOLANA_SAMPLE)
      expect(res).toContain('🚨 *HIGH RISK / RUG WARNING*')
      expect(res).toContain('Freeze Authority: *Enabled 🚨*')
      expect(res).toContain('Honeypot: *🚨 YES*')
      expect(res).toContain('Buy / Sell Tax: *10.0% / 99.0%*')
    })

    it('handles audit failure gracefully with DexScreener link', async () => {
      vi.mocked(auditRugcheckToken).mockRejectedValueOnce(new Error('Network offline'))

      const res = await formatTokenCheck(SOLANA_SAMPLE)
      expect(res).toContain('⚠️ *Security Audit Unavailable*')
      expect(res).toContain('dexscreener.com/solana')
    })

    it('formatTopMeme returns formatted top tokens or fallback message', async () => {
      const text = await formatTopMeme()
      expect(typeof text).toBe('string')
      expect(text.length).toBeGreaterThan(0)
    })

    it('formatSniperScan returns formatted sniper radar or status message', async () => {
      const text = await formatSniperScan()
      expect(typeof text).toBe('string')
      expect(text).toContain('Sniper Radar')
    })
  })

  describe('handleCallback', () => {
    it('act:rugcheck gives paste instructions', async () => {
      await handleCallback(makeCallback('act:rugcheck'))
      expect(callTelegram).toHaveBeenCalledWith('answerCallbackQuery', expect.objectContaining({
        callback_query_id: 'cb_123',
      }))
      expect(callTelegram).toHaveBeenCalledWith('sendMessage', expect.objectContaining({
        text: expect.stringContaining('Paste any Solana'),
      }))
    })

    it('act:token-search gives paste instructions', async () => {
      await handleCallback(makeCallback('act:token-search'))
      expect(callTelegram).toHaveBeenCalledWith('sendMessage', expect.objectContaining({
        text: expect.stringContaining('Paste a token contract address directly'),
      }))
    })

    it('act:help edits message with full help text', async () => {
      await handleCallback(makeCallback('act:help'))
      expect(callTelegram).toHaveBeenCalledWith('editMessageText', expect.objectContaining({
        message_id: 42,
        text: formatHelpText(),
      }))
    })

    it('data:top invokes formatTopMeme and edits message', async () => {
      await handleCallback(makeCallback('data:top'))
      expect(callTelegram).toHaveBeenCalledWith('editMessageText', expect.objectContaining({
        message_id: 42,
        text: expect.stringMatching(/Top Trending Tokens|No trending meme tokens/),
      }))
    })

    it('data:scan invokes formatSniperScan and edits message', async () => {
      await handleCallback(makeCallback('data:scan'))
      expect(callTelegram).toHaveBeenCalledWith('editMessageText', expect.objectContaining({
        message_id: 42,
        text: expect.stringMatching(/Sniper Radar/),
      }))
    })
  })
})
