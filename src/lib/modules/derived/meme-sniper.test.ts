// Contract tests: meme sniper hard filters, decision protocol, risk plan,
// and Telegram message safety. Pure evaluator — zero network, zero DB.
import { describe, it, expect } from 'vitest'
import { evaluateSniper, escapeMd, SNIPER_LIMITS, type SniperPayload } from './meme-sniper'

function clean(over: Partial<SniperPayload> = {}): SniperPayload {
  return {
    ticker: 'WIF',
    contract: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    ageMinutes: 30,
    security: { mintable: false, freezeAuthority: false, lpBurnedPercent: 100, lpLockedPercent: 0, honeypot: false },
    distribution: {
      devPercent: 0,
      sniperPercent: 1,
      bundlerPercent: 4,
      insiderPercent: 2,
      top10Percent: 18,
      clusterPercent: 2,
      topWallets: [
        { address: 'Holder111111111111111111111111111111111111', percent: 5, kind: 'holder' },
        { address: 'Holder222222222222222222222222222222222222', percent: 4, kind: 'holder' },
        { address: 'Holder333333333333333333333333333333333333', percent: 3, kind: 'holder' },
      ],
    },
    momentum: { marketCap: 1_000_000, volume5m: 3_000_000, top5AvgPnlPercent: 20, narrative: 'AI agent meta' },
    ...over,
  }
}

describe('meme-sniper hard filters', () => {
  it('passes a clean payload as EXECUTE and renders every audited field', () => {
    const d = evaluateSniper(clean())
    expect(d.status).toBe('EXECUTE')
    expect(d.rejections).toEqual([])
    expect(d.alert).toContain('VILONA MEME SNIPER')
    expect(d.alert).toContain('Dev Holding:* 0%')
    expect(d.alert).toContain('Mint OFF ✅')
    expect(d.alert).toContain('100% Burnt/Locked ✅')
    expect(d.alert).toContain('*[EXECUTE]*')
    expect(d.alert).toContain('Ratio:* 3.00x')
  })

  it('rejects mint authority enabled AND unproven', () => {
    expect(evaluateSniper(clean({ security: { ...clean().security, mintable: true } })).status).toBe('REJECT')
    const unproven = evaluateSniper(clean({ security: { ...clean().security, mintable: null } }))
    expect(unproven.status).toBe('REJECT')
    expect(unproven.rejections.join(' ')).toContain('Mint authority unproven')
  })

  it('rejects freeze authority enabled AND unproven', () => {
    expect(evaluateSniper(clean({ security: { ...clean().security, freezeAuthority: true } })).status).toBe('REJECT')
    expect(evaluateSniper(clean({ security: { ...clean().security, freezeAuthority: null } })).status).toBe('REJECT')
  })

  it('rejects LP that is not 100% burnt or locked', () => {
    const d = evaluateSniper(clean({ security: { ...clean().security, lpBurnedPercent: 60, lpLockedPercent: 30 } }))
    expect(d.status).toBe('REJECT')
    expect(d.rejections.join(' ')).toContain('LP only 90%')
  })

  it('accepts LP that is split between burnt and locked to 100%', () => {
    const d = evaluateSniper(clean({ security: { ...clean().security, lpBurnedPercent: 70, lpLockedPercent: 30 } }))
    expect(d.status).toBe('EXECUTE')
  })

  it('rejects a honeypot outright', () => {
    const d = evaluateSniper(clean({ security: { ...clean().security, honeypot: true } }))
    expect(d.status).toBe('REJECT')
    expect(d.rejections.join(' ')).toContain('Honeypot')
  })

  it('rejects dev holding at 0.5% (0% is the only pass)', () => {
    const d = evaluateSniper(clean({ distribution: { ...clean().distribution, devPercent: 0.5 } }))
    expect(d.status).toBe('REJECT')
    expect(d.rejections.join(' ')).toContain('must be 0%')
  })

  it('rejects dev holding beyond the 2% hard ceiling with stronger wording', () => {
    const d = evaluateSniper(clean({ distribution: { ...clean().distribution, devPercent: 5 } }))
    expect(d.status).toBe('REJECT')
    expect(d.rejections.join(' ')).toContain('beyond hard ceiling')
  })

  it('rejects snipers at the 6% ceiling', () => {
    const d = evaluateSniper(clean({ distribution: { ...clean().distribution, sniperPercent: 6 } }))
    expect(d.status).toBe('REJECT')
    expect(d.rejections.join(' ')).toContain('Snipers hold 6%')
  })

  it('rejects bundlers above 10% when they have not fully exited', () => {
    const d = evaluateSniper(clean({
      distribution: { ...clean().distribution, bundlerPercent: 20, bundlerSoldPercent: 40 },
    }))
    expect(d.status).toBe('REJECT')
    expect(d.rejections.join(' ')).toContain('not fully exited')
  })

  it('tolerates bundlers up to 30% only when 100% sold', () => {
    const sold = evaluateSniper(clean({
      distribution: { ...clean().distribution, bundlerPercent: 25, bundlerSoldPercent: 100 },
    }))
    expect(sold.status).toBe('EXECUTE')
    const unsold = evaluateSniper(clean({
      distribution: { ...clean().distribution, bundlerPercent: 25, bundlerSoldPercent: 99 },
    }))
    expect(unsold.status).toBe('REJECT')
  })

  it('rejects bundlers above the 30% tolerated max even when fully sold', () => {
    const d = evaluateSniper(clean({
      distribution: { ...clean().distribution, bundlerPercent: 35, bundlerSoldPercent: 100 },
    }))
    expect(d.status).toBe('REJECT')
    expect(d.rejections.join(' ')).toContain('above tolerated max 30%')
  })

  it('rejects insiders at the 5% ceiling', () => {
    expect(evaluateSniper(clean({ distribution: { ...clean().distribution, insiderPercent: 5 } })).status).toBe('REJECT')
  })

  it('rejects top-10 supply at the 30% ceiling', () => {
    expect(evaluateSniper(clean({ distribution: { ...clean().distribution, top10Percent: 30 } })).status).toBe('REJECT')
  })

  it('rejects a linked cluster above 5%', () => {
    const d = evaluateSniper(clean({ distribution: { ...clean().distribution, clusterPercent: 6 } }))
    expect(d.status).toBe('REJECT')
    expect(d.rejections.join(' ')).toContain('Linked cluster holds 6%')
  })

  it('rejects when any top-1-3 wallet is fresh / sniper / dev / bundler / insider', () => {
    for (const kind of ['fresh', 'sniper', 'dev', 'bundler', 'insider'] as const) {
      const d = evaluateSniper(clean({
        distribution: {
          ...clean().distribution,
          topWallets: [{ address: 'Bad1111111111111111111111111111111111111111', percent: 9, kind }],
        },
      }))
      expect(d.status, `kind ${kind}`).toBe('REJECT')
      expect(d.rejections.join(' ')).toContain(`is a ${kind} wallet`)
    }
  })

  it('only gates the top three wallets, not the tail', () => {
    const d = evaluateSniper(clean({
      distribution: {
        ...clean().distribution,
        topWallets: [
          { address: 'H11111111111111111111111111111111111111111', percent: 9, kind: 'holder' },
          { address: 'H21111111111111111111111111111111111111111', percent: 8, kind: 'holder' },
          { address: 'H31111111111111111111111111111111111111111', percent: 7, kind: 'holder' },
          { address: 'S41111111111111111111111111111111111111111', percent: 6, kind: 'sniper' },
        ],
      },
    }))
    expect(d.status).toBe('EXECUTE')
  })

  it('treats unknown distribution fields as unproven, never safe', () => {
    const d = evaluateSniper(clean({
      distribution: {
        devPercent: null, sniperPercent: null, bundlerPercent: null,
        insiderPercent: null, top10Percent: null,
      },
    }))
    expect(d.status).toBe('REJECT')
    expect(d.rejections.length).toBe(5)
  })
})

describe('meme-sniper momentum gates', () => {
  it('requires 2x vol/mcap for a new pair (<2h)', () => {
    const below = evaluateSniper(clean({ ageMinutes: 30, momentum: { marketCap: 1e6, volume5m: 1.5e6 } }))
    expect(below.status).toBe('REJECT')
    expect(below.rejections.join(' ')).toContain('required 2x')
    expect(evaluateSniper(clean({ ageMinutes: 30, momentum: { marketCap: 1e6, volume5m: 2e6 } })).status).toBe('EXECUTE')
  })

  it('requires 4x vol/mcap after bonding (>=2h)', () => {
    const below = evaluateSniper(clean({ ageMinutes: 180, momentum: { marketCap: 1e6, volume5m: 3e6 } }))
    expect(below.status).toBe('REJECT')
    expect(below.rejections.join(' ')).toContain('required 4x')
    expect(evaluateSniper(clean({ ageMinutes: 180, momentum: { marketCap: 1e6, volume5m: 4e6 } })).status).toBe('EXECUTE')
  })

  it('honors an explicit stage over the age heuristic', () => {
    const d = evaluateSniper(clean({ ageMinutes: 30, stage: 'post-bonding', momentum: { marketCap: 1e6, volume5m: 3e6 } }))
    expect(d.status).toBe('REJECT')
  })

  it('rejects a zero market cap instead of dividing by zero', () => {
    const d = evaluateSniper(clean({ momentum: { marketCap: 0, volume5m: 5e6 } }))
    expect(d.status).toBe('REJECT')
    expect(Number.isFinite(d.metrics.volMcRatio)).toBe(true)
  })
})

describe('meme-sniper decision protocol', () => {
  it('flags top-holder PnL > +150% as dump risk and downgrades to WATCHLIST', () => {
    const d = evaluateSniper(clean({ momentum: { marketCap: 1e6, volume5m: 3e6, top5AvgPnlPercent: 260 } }))
    expect(d.status).toBe('WATCHLIST')
    expect(d.metrics.pnlAssessment).toBe('dump-risk')
    expect(d.rationale).toContain('wait for the flush')
  })

  it('labels < +50% top-holder PnL as accumulation', () => {
    const d = evaluateSniper(clean({ momentum: { marketCap: 1e6, volume5m: 3e6, top5AvgPnlPercent: 12 } }))
    expect(d.status).toBe('EXECUTE')
    expect(d.metrics.pnlAssessment).toBe('accumulation')
    expect(d.rationale).toContain('accumulating')
  })

  it('a hard breach outranks dump risk (REJECT beats WATCHLIST)', () => {
    const d = evaluateSniper(clean({
      security: { ...clean().security, mintable: true },
      momentum: { marketCap: 1e6, volume5m: 3e6, top5AvgPnlPercent: 300 },
    }))
    expect(d.status).toBe('REJECT')
  })

  it('a locked daily circuit blocks an otherwise clean snipe', () => {
    const d = evaluateSniper(clean(), { circuitLocked: true })
    expect(d.status).toBe('REJECT')
    expect(d.rejections).toEqual([])
    expect(d.rationale).toContain('circuit')
  })
})

describe('meme-sniper risk plan', () => {
  it('uses the fixed degen band and exactly -70% / +100% / +400%', () => {
    const d = evaluateSniper(clean(), { positionSizeUsd: 20 })
    expect(d.plan).toEqual({ sizeUsd: 20, stopLossPct: 70, slAmountUsd: 14, tp1Pct: 100, tp2Pct: 400 })
    expect(d.alert).toContain('Stop Loss: -70% ($14.00)')
    expect(d.alert).toContain('TP1: +100% (Free Ride)')
  })

  it('clamps an out-of-band requested size into 5..20', () => {
    expect(evaluateSniper(clean(), { positionSizeUsd: 500 }).plan.sizeUsd).toBe(SNIPER_LIMITS.maxSizeUsd)
    expect(evaluateSniper(clean(), { positionSizeUsd: 1 }).plan.sizeUsd).toBe(SNIPER_LIMITS.minSizeUsd)
    expect(evaluateSniper(clean()).plan.sizeUsd).toBe(SNIPER_LIMITS.defaultSizeUsd)
  })
})

describe('meme-sniper alert safety', () => {
  it('escapes Telegram Markdown control characters in dynamic text', () => {
    // Only `_ * \` \`` `[` are special per the Bot API — `]` stays bare.
    expect(escapeMd('WIF_2*X[1]')).toBe('WIF\\_2\\*X\\[1]')
  })

  it('neutralizes a ticker/narrative that would break Markdown parsing', () => {
    const d = evaluateSniper(clean({
      ticker: 'EVIL_*[x]',
      momentum: { marketCap: 1e6, volume5m: 3e6, narrative: 'a_b*c[d]' },
    }))
    // Every dynamic control char is escaped, so the message stays parseable.
    expect(d.alert).toContain('EVIL\\_\\*\\[x]')
    expect(d.alert).toContain('a\\_b\\*c\\[d]')
  })

  it('states an explicit fallback when no narrative is supplied', () => {
    const d = evaluateSniper(clean({ momentum: { marketCap: 1e6, volume5m: 3e6 } }))
    expect(d.alert).toContain('No catalyst data provided')
  })
})
