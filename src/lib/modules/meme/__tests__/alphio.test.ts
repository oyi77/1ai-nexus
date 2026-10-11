import { afterEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverAlphioTokens, searchAlphioTokens, auditAlphioToken } from '../alphio'
import { __resetAlphioSessionForTests, writeAlphioSession } from '../alphio/session'

const TOKEN_ROW = {
  chain: 'solana',
  mint: 'F8NNTOKEN1111111111111111111111111111111111',
  name: 'Test Coin',
  symbol: 'TEST',
  creator: '',
  created_at: '1791485507000',
  migrated_at: '0',
  status: 'stream',
  price_usd: 0.0005,
  market_cap_usd: 500000,
  liquidity_usd: 36000,
  holders: '6928',
  volume_24h_usd: 9500000,
  price_change_24h: '12.5',
  dev_holding_pct: 0,
  dev_sold_pct: 100,
  top10_holding_pct: 18.0,
  insider_pct: 4.1,
  sniper_pct: 0,
  bundler_pct: 9.5,
  twitter: 'https://x.com/test',
  telegram: '',
  website: '',
}

const HOLDER_ROW = {
  address: 'Wallet11111111111111111111111111111111111',
  balance: '1000000',
  pct_of_supply: '5.0',
  buy_amount_usd: '400',
  sell_amount_usd: '0',
  avg_buy_price_usd: '0.0004',
  realized_pnl_usd: '0',
  buys: '12',
  sells: '0',
}

function mockAlphioFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new Error('request aborted')
      expect(input).toContain('api.alphio.ai')
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? ''
      expect(auth).toMatch(/^Bearer \S+$/)
      const url = String(input)
      if (url.includes('/v1/crypto/meme/token?')) {
        return new Response(JSON.stringify({ ret: 0, msg: 'OK', data: TOKEN_ROW }), { status: 200 })
      }
      if (url.includes('/v1/crypto/meme/holders?')) {
        return new Response(
          JSON.stringify({ ret: 0, data: { list: [HOLDER_ROW], total_holders: '100' } }),
          { status: 200 },
        )
      }
      // trending / new-tokens / search all share the {ret,list} envelope
      return new Response(JSON.stringify({ ret: 0, msg: 'OK', list: [TOKEN_ROW] }), { status: 200 })
    }),
  )
}

/** Stage a temp session file so tests never read the repo's real staged one. */
function stageSession(accessToken: string): void {
  process.env.ALPHIO_SESSION_PATH = join(
    tmpdir(),
    `alphio-test-${Math.random().toString(36).slice(2)}.json`,
  )
  __resetAlphioSessionForTests()
  writeAlphioSession({ accessToken, accessTokenExp: Date.now() + 3600_000 })
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete process.env.ALPHIO_API_KEY
  delete process.env.ALPHIO_SESSION_PATH
  __resetAlphioSessionForTests()
})
describe('alphio session gating', () => {

  it('returns empty discovery without credentials', async () => {
    // Hermetic: the repo may have a real staged session on disk — point the
    // loader at a path that cannot exist so this asserts the no-credential path.
    process.env.ALPHIO_SESSION_PATH = join(tmpdir(), 'alphio-absent-session.json')
    delete process.env.ALPHIO_API_KEY
    __resetAlphioSessionForTests()
    mockAlphioFetch()
    await expect(discoverAlphioTokens(5)).resolves.toEqual([])
    await expect(searchAlphioTokens('x')).resolves.toEqual([])
    await expect(auditAlphioToken('solana', 'MINT')).resolves.toBeNull()
  })

  it('enables via ALPHIO_API_KEY env', async () => {
    process.env.ALPHIO_API_KEY = 'env-token'
    mockAlphioFetch()
    const tokens = await discoverAlphioTokens(5)
    expect(tokens).toHaveLength(1)
    expect(tokens[0].platform).toBe('alphio')
  })
})

describe('discoverAlphioTokens', () => {
  it('preserves Alphio identity and authed provenance', async () => {
    stageSession('file-token')
    mockAlphioFetch()

    const tokens = await discoverAlphioTokens(10)
    expect(tokens).toHaveLength(1)
    expect(tokens[0].platform).toBe('alphio')
    expect(tokens[0].chain).toBe('solana')
    expect(tokens[0].symbol).toBe('TEST')
    expect(tokens[0].price).toBeCloseTo(0.0005, 6)
    expect(tokens[0].volume24h).toBe(9500000)
    expect(tokens[0].holders).toBe(6928)
    // top10 arrives as a percentage upstream — adapter emits a fraction
    expect(tokens[0].top10HolderPercent).toBeCloseTo(0.18, 4)
    expect(tokens[0].provenance).toEqual({
      sourceType: 'reverse-engineered',
      provider: 'alphio',
      experimental: true,
      note: "Member API (Bearer) RE'd from app.alphio.ai; self-gates when no session.",
    })
    expect(tokens[0].riskKnown).toBe(false)
  })
})

describe('auditAlphioToken', () => {
  it('maps concentration splits to distribution + sniper ceilings', async () => {
    stageSession('file-token')
    mockAlphioFetch()

    const audit = await auditAlphioToken('solana', TOKEN_ROW.mint)
    expect(audit).not.toBeNull()
    expect(audit!.platform).toBe('alphio')
    expect(audit!.chain).toBe('solana')
    expect(audit!.symbol).toBe('TEST')
    expect(audit!.top10HolderPercent).toBeCloseTo(0.18, 4)
    expect(audit!.distribution!.devPercent).toBe(0)
    expect(audit!.distribution!.sniperPercent).toBe(0)
    expect(audit!.distribution!.bundlerPercent).toBeCloseTo(0.095, 6)
    expect(audit!.distribution!.insiderPercent).toBeCloseTo(0.041, 6)
    expect(audit!.topWallets).toHaveLength(1)
    expect(audit!.topWallets![0].percent).toBeCloseTo(0.05, 4)
    // nontrivial concentration -> middle, not fabricated low
    expect(audit!.riskLevel).toBe(2)
    expect(audit!.riskLabel).toBe('middle')
  })

  it('computes top-5 unrealized PnL from holders cost basis', async () => {
    stageSession('file-token')
    const rows = Array.from({ length: 5 }, (_, i) => ({ ...HOLDER_ROW, address: `W${i}` }))
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = String(input)
        if (url.includes('/v1/crypto/meme/holders?')) {
          return new Response(
            JSON.stringify({ ret: 0, data: { list: rows, total_holders: '5' } }),
            { status: 200 },
          )
        }
        return new Response(JSON.stringify({ ret: 0, msg: 'OK', data: TOKEN_ROW }), {
          status: 200,
        })
      }),
    )

    const audit = await auditAlphioToken('solana', TOKEN_ROW.mint)
    // (0.0005 - 0.0004) / 0.0004 * 100 = 25% each
    expect(audit!.top5AvgPnlPercent).toBeCloseTo(25, 4)
  })

  it('flags dev concentration above the hard ceiling', async () => {
    stageSession('file-token')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = String(input)
        if (url.includes('/v1/crypto/meme/token?')) {
          return new Response(
            JSON.stringify({ ret: 0, msg: 'OK', data: { ...TOKEN_ROW, dev_holding_pct: 5 } }),
            { status: 200 },
          )
        }
        return new Response(JSON.stringify({ ret: 0, data: { list: [] } }), { status: 200 })
      }),
    )

    const audit = await auditAlphioToken('solana', TOKEN_ROW.mint)
    expect(audit!.riskLevel).toBe(3)
    expect(audit!.riskLabel).toBe('high')
  })

  it('returns null for non-ok envelopes', async () => {
    stageSession('file-token')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ret: 10023, msg: 'user not login' }), { status: 200 })),
    )
    await expect(auditAlphioToken('solana', 'MINT')).resolves.toBeNull()
  })
})
