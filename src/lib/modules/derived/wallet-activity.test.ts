import { describe, expect, it } from 'vitest'
import {
  fetchWalletActivity,
  mapGmgnActivityToSwap,
  toEpochMs,
  type GmgnActivityRow,
} from './wallet-activity'
import { __setGmgnCurlForTests } from '@/lib/modules/meme/gmgn'
import { __setHarvestFetchForTests } from './solana-harvest'

const W = '4vw54BmAogeRV3vPKWyFet5yf8DTLcREzdSzx4rw9Ud9'
const NOW = 1_800_000_000_000

describe('toEpochMs', () => {
  it('converts seconds to ms', () => {
    expect(toEpochMs(1_791_951_396)).toBe(1_791_951_396_000)
  })

  it('returns null for missing, zero, negative or non-finite', () => {
    expect(toEpochMs(null)).toBeNull()
    expect(toEpochMs(undefined)).toBeNull()
    expect(toEpochMs(0)).toBeNull()
    expect(toEpochMs(-5)).toBeNull()
    expect(toEpochMs(Number.NaN)).toBeNull()
  })

  it('rejects future timestamps more than an hour ahead', () => {
    const futureSec = NOW / 1000 + 7200
    expect(toEpochMs(futureSec, NOW)).toBeNull()
    const nearFutureSec = NOW / 1000 + 600
    expect(toEpochMs(nearFutureSec, NOW)).toBe(nearFutureSec * 1000)
  })
})

describe('mapGmgnActivityToSwap', () => {
  const buyRow: GmgnActivityRow = {
    tx_hash: 'sig-buy-1',
    timestamp: 1_791_951_396,
    event_type: 'buy',
    token: { address: 'CNMVS8E419EaRDQkj36weSirhDXjRSVfaZJZCJMppump', symbol: 'OR' },
    token_amount: '2140272.598867',
    quote_amount: '0.244444443',
    cost_usd: '26.29244428908',
    quote_token: { token_address: 'So11111111111111111111111111111111111111112', symbol: 'WSOL', decimals: 9 },
    quote_address: 'So11111111111111111111111111111111111111112',
    gas_native: '0.000505',
    gas_usd: '0.05430265',
  }

  it('maps a buy row: quote→token, complete with trade-time USD', () => {
    const s = mapGmgnActivityToSwap(W, buyRow, NOW)
    expect(s.chain).toBe('solana')
    expect(s.source).toBe('gmgn:wallet_activity')
    expect(s.completeness).toBe('complete')
    expect(s.inputMint).toBe('So11111111111111111111111111111111111111112')
    expect(s.outputMint).toBe('CNMVS8E419EaRDQkj36weSirhDXjRSVfaZJZCJMppump')
    expect(s.inputAmount).toBeCloseTo(0.244444443, 6)
    expect(s.outputAmount).toBeCloseTo(2140272.598867, 4)
    expect(s.inputUsd).toBeCloseTo(26.29244428908, 6)
    expect(s.timestamp).toBe(1_791_951_396_000)
    expect(s.feeUsd).toBeCloseTo(0.05430265, 8)
    expect(s.feeKnown).toBe(true)
  })

  it('maps a sell row: token→quote', () => {
    const s = mapGmgnActivityToSwap(W, { ...buyRow, event_type: 'sell' }, NOW)
    expect(s.inputMint).toBe('CNMVS8E419EaRDQkj36weSirhDXjRSVfaZJZCJMppump')
    expect(s.outputMint).toBe('So11111111111111111111111111111111111111112')
    expect(s.inputAmount).toBeCloseTo(2140272.598867, 4)
    expect(s.outputAmount).toBeCloseTo(0.244444443, 6)
  })

  it('marks a row with no USD as complete but flagged missing-usd', () => {
    const row: GmgnActivityRow = { ...buyRow, cost_usd: undefined }
    const s = mapGmgnActivityToSwap(W, row, NOW)
    expect(s.completeness).toBe('complete')
    expect(s.inputUsd).toBeNull()
    expect(s.limitations).toContain('missing-usd')
  })

  it('rejects rows missing tx hash, timestamp, mint, amount or buy/sell side', () => {
    expect(mapGmgnActivityToSwap(W, { ...buyRow, tx_hash: '' }, NOW).rejectReason).toBe('missing-tx-hash')
    expect(mapGmgnActivityToSwap(W, { ...buyRow, timestamp: 0 }, NOW).rejectReason).toBe('missing-timestamp')
    expect(mapGmgnActivityToSwap(W, { ...buyRow, token: {} }, NOW).rejectReason).toBe('missing-token-mint')
    expect(mapGmgnActivityToSwap(W, { ...buyRow, token_amount: '0' }, NOW).rejectReason).toBe('nonpositive-token-amount')
    expect(mapGmgnActivityToSwap(W, { ...buyRow, event_type: 'transfer' }, NOW).rejectReason).toBe('unsupported-event-type:transfer')
  })

  it('defaults quote side to wrapped SOL when the row omits quote fields', () => {
    const s = mapGmgnActivityToSwap(W, {
      tx_hash: 'sig-sol-default',
      timestamp: 1_791_951_396,
      event_type: 'buy',
      token: { address: 'tok', symbol: 'T' },
      token_amount: '10',
      quote_amount: '0.5',
      cost_usd: '20',
    }, NOW)
    expect(s.inputMint).toBe('So11111111111111111111111111111111111111112')
  })
})

describe('fetchWalletActivity source selection', () => {
  it('returns a clean honest no-op when no source works', async () => {
    // GMGN transport fails and the public RPC 429s — both are real failure
    // modes and the result must never fabricate a swap.
    __setGmgnCurlForTests(() => {
      throw new Error('GMGN Cloudflare challenge: test stub')
    })
    __setHarvestFetchForTests(async () =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: 429, message: 'throttled' } }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }) as Response,
    )
    try {
      const res = await fetchWalletActivity(W, { limit: 5 })
      expect(res.source).toBe('none')
      expect(res.swaps).toEqual([])
      expect(res.coverage.gaps.some((g) => g.includes('no keyless source'))).toBe(true)
    } finally {
      __setHarvestFetchForTests(null)
      __setGmgnCurlForTests(null)
    }
  }, 30_000)
})
