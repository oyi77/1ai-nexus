import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchApi } from '../core'
import { formatSniperScan } from '../formatters'

vi.mock('../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core')>()
  return { ...actual, fetchApi: vi.fn() }
})

vi.mock('@/lib/modules/meme/rugcheck', () => ({ auditRugcheckToken: vi.fn() }))
vi.mock('@/lib/modules/derived/sniper-log', () => ({
  readSniperLog: vi.fn(() => ({ entries: [], updatedAt: null, lastScan: null })),
  sniperLogCounts: vi.fn(() => ({})),
}))

const CONTRACT = 'So11111111111111111111111111111111111111112'

describe('formatSniperScan', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses ticker, market.marketCapUsd, and rejections from the actual log shape', async () => {
    vi.mocked(fetchApi).mockResolvedValue({
      entries: [{
        ticker: 'risky',
        contract: CONTRACT,
        status: 'REJECT',
        market: { marketCapUsd: 1_250_000 },
        rejections: ['Insufficient liquidity'],
      }],
      lastScan: null,
    })

    const text = await formatSniperScan()
    expect(text).toContain('*RISKY*')
    expect(text).toContain('$1.3M')
    expect(text).toContain('Insufficient liquidity')
    expect(text).not.toContain('UNKNOWN')
  })

  it('handles missing ticker, null market, and absent rejections without failing', async () => {
    vi.mocked(fetchApi).mockResolvedValue({
      entries: [{ contract: null, status: 'WATCHLIST', market: null }],
      lastScan: null,
    })

    const text = await formatSniperScan()
    expect(text).toContain('*UNKNOWN*')
    expect(text).toContain('WATCHLIST')
    expect(text).not.toContain('undefined')
    expect(text).not.toContain('null')
  })
})
