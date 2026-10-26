import { afterEach, vi } from 'vitest'
import { fetchBridgeFlows } from '@/lib/modules/chain/bridge/flows'
import { fetchMempoolEvents } from '@/lib/modules/chain/mempool/intel'
import { fetchStakingQueue } from '@/lib/modules/chain/ethereum/staking-queue'

vi.mock('@/lib/db', () => ({ prisma: {} }))

import { describe, expect, it } from 'vitest'
import { fmtPercent, fmtUsd } from '@/app/exchange-flow/format'
import { aggregateChains } from '@/app/sectors/content'

describe('sector chain aggregation', () => {
  it('allocates protocol TVL and changes per chain without double counting', () => {
    const rows = aggregateChains([
      { name: 'A', chain: 'Ethereum', chains: ['Ethereum', 'Solana'], chainTvls: { Ethereum: 80, Solana: 20 }, tvl: 100, change_1d: 2, change_7d: 10 },
      { name: 'B', chain: 'Solana', chains: ['Ethereum', 'Solana'], chainTvls: { Ethereum: 20, Solana: 180 }, tvl: 200, change_1d: 4, change_7d: -10 },
    ])

    expect(rows).toEqual([
      expect.objectContaining({ name: 'Solana', tvl: 200, change1d: 3.8, change7d: -8, topProtocol: 'B' }),
      expect.objectContaining({ name: 'Ethereum', tvl: 100, change1d: 2.4, change7d: 6, topProtocol: 'A' }),
    ])
  })
})

describe('exchange-flow content formatting', () => {
  it('never renders missing or non-finite metrics as real values', () => {
    expect(fmtUsd(undefined)).toBe('—')
    expect(fmtUsd(Number.NaN)).toBe('—')
    expect(fmtUsd(Number.POSITIVE_INFINITY)).toBe('—')
    expect(fmtPercent(null)).toBe('—')
    expect(fmtPercent(Number.NaN)).toBe('—')
    expect(fmtPercent(-1.25)).toBe('-1.25%')
    expect(fmtPercent(1.25)).toBe('+1.25%')
  })
})

describe('on-chain source integrity', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('emits transfers only from actual unconfirmed transactions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ txs: [
      { hash: 'small', out: [{ value: 100_000_000 }] },
      { hash: 'whale', out: [{ value: 600_000_000 }, { value: 400_000_000 }], time: 1_700_000_000 },
    ] }), { status: 200 })))
    vi.setSystemTime(1_700_000_000_000)

    await expect(fetchMempoolEvents()).resolves.toEqual([expect.objectContaining({
      chain: 'BTC', type: 'large_transfer', asset: 'BTC', estUsd: null,
      metadata: expect.objectContaining({ txid: 'whale', valueBtc: 10 }),
    })])
    vi.useRealTimers()
  })

  it('does not convert mempool congestion into transfer events', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ count: 50_000 }), { status: 200 })))
    await expect(fetchMempoolEvents()).rejects.toThrow('shape invalid')
  })

  it('keeps staking wait times unknown instead of fabricating an epoch', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{}] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{}, {}] }), { status: 200 })))
    await expect(fetchStakingQueue()).resolves.toMatchObject({ entryQueue: 1, exitQueue: 2, entryWaitDays: null, exitWaitDays: null })
  })

  it('does not mislabel failed bridge-flow fetches as an empty healthy feed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('upstream down')))
    await expect(fetchBridgeFlows()).rejects.toThrow('upstream down')
  })
})
