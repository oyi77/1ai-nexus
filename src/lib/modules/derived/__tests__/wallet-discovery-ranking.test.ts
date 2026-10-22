import { describe, it, expect } from 'vitest'
import { sortLeaderboardSurvivors } from '../wallet-discovery-ranking'
import type { HarvestedWallet } from '@/lib/modules/meme/whale-harvester'

function row(address: string, w: Partial<HarvestedWallet>): [string, { w: HarvestedWallet; tags: string[] }] {
  return [
    address,
    {
      w: {
        address,
        name: '',
        source: 'test',
        winRate30d: w.winRate30d ?? 0,
        pnl30d: w.pnl30d ?? 0,
        realizedProfit30d: w.realizedProfit30d ?? 0,
        buyVolume30d: w.buyVolume30d ?? 0,
        windows: ['30d'],
      },
      tags: [],
    },
  ]
}

describe('sortLeaderboardSurvivors — the measurement budget goes to wallets that can clear the bar', () => {
  it('puts a small wallet that clears quality ahead of a huge-volume whale that does not', () => {
    const whale = row('whale', { winRate30d: 0.45, pnl30d: 0.2, buyVolume30d: 5_000_000 })
    const quality = row('quality', { winRate30d: 0.62, pnl30d: 0.75, buyVolume30d: 40_000 })
    const sorted = sortLeaderboardSurvivors([whale, quality], 0.6, 0.7)
    expect(sorted.map(([a]) => a)).toEqual(['quality', 'whale'])
  })

  it('orders non-qualifying rows by 30d buy volume', () => {
    const big = row('big', { winRate30d: 0.3, pnl30d: 0.1, buyVolume30d: 900_000 })
    const small = row('small', { winRate30d: 0.3, pnl30d: 0.1, buyVolume30d: 300_000 })
    const sorted = sortLeaderboardSurvivors([small, big], 0.6, 0.7)
    expect(sorted.map(([a]) => a)).toEqual(['big', 'small'])
  })

  it('is stable for identical wallets, so a pass is reproducible', () => {
    const a = row('aaa', { winRate30d: 0.3, pnl30d: 0.1, buyVolume30d: 1 })
    const b = row('bbb', { winRate30d: 0.3, pnl30d: 0.1, buyVolume30d: 1 })
    expect(sortLeaderboardSurvivors([b, a], 0.6, 0.7).map(([x]) => x)).toEqual(['aaa', 'bbb'])
    expect(sortLeaderboardSurvivors([a, b], 0.6, 0.7).map(([x]) => x)).toEqual(['aaa', 'bbb'])
  })

  it('does not mutate the caller array', () => {
    const input = [row('b', { buyVolume30d: 1 }), row('a', { buyVolume30d: 9 })]
    sortLeaderboardSurvivors(input, 0.6, 0.7)
    expect(input.map(([a]) => a)).toEqual(['b', 'a'])
  })
})
