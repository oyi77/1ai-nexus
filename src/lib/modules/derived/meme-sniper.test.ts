// Contract tests: meme sniper hard filters, decision protocol, risk plan,
// and Telegram message safety. Pure evaluator — zero network, zero DB.
import { describe, it, expect } from 'vitest'
import { evaluateSniper, escapeHtml, type SniperPayload } from './meme-sniper'

/** Verified buyer — the only path to SIGNAL now that execution is gone. */
const CONFIRMED = { verdict: 'pass' as const, reason: 'verified buyer', strongest: 'QUALIFIED_SMART_MONEY' }

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
  it('passes a clean payload as SIGNAL and renders every audited field', () => {
    const d = evaluateSniper(clean(), { smartMoney: CONFIRMED })
    expect(d.status).toBe('SIGNAL')
    expect(d.rejections).toEqual([])
    expect(d.alert).toContain('<b>VILONA MEME SNIPER')
    expect(d.alert).toContain('<b>Dev Holding:</b> 0.00% ✅ (Dev Keluar ✅)')
    expect(d.alert).toContain('Mint 🟢 MATI | Freeze 🟢 MATI | LP')
    expect(d.alert).toContain('100% BURNT ✅')
    expect(d.alert).toContain('🟢 SIGNAL')
    expect(d.alert).toContain('<b>Ratio:</b> 3.00x')
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
    const d = evaluateSniper(clean({ security: { ...clean().security, lpBurnedPercent: 70, lpLockedPercent: 30 } }), { smartMoney: CONFIRMED })
    expect(d.status).toBe('SIGNAL')
  })
  it('names an unmeasured LP leg instead of printing it as a measured zero', () => {
    const partial = evaluateSniper(
      clean({ security: { ...clean().security, lpBurnedPercent: null, lpLockedPercent: 60 } }),
      { smartMoney: CONFIRMED },
    )
    expect(partial.alert).toContain('LP burn n/a + lock 60.00% ❓')
    expect(partial.alert).not.toContain('60.00% 🔴')
    const locked = evaluateSniper(
      clean({ security: { ...clean().security, lpBurnedPercent: null, lpLockedPercent: 100 } }),
      { smartMoney: CONFIRMED },
    )
    expect(locked.alert).toContain('LP 100% LOCKED ✅')
    expect(locked.alert).not.toContain('n/a')
    const burnt = evaluateSniper(
      clean({ security: { ...clean().security, lpBurnedPercent: 100, lpLockedPercent: null } }),
      { smartMoney: CONFIRMED },
    )
    expect(burnt.alert).toContain('LP 100% BURNT ✅')
    expect(burnt.alert).not.toContain('n/a')
    const neither = evaluateSniper(
      clean({ security: { ...clean().security, lpBurnedPercent: null, lpLockedPercent: null } }),
      { smartMoney: CONFIRMED },
    )
    expect(neither.alert).toContain('LP burn n/a + lock n/a ❓')
    expect(neither.alert).not.toContain('n/a%')
  })

  it('accepts 100% locked with burn unproven; caps fully-unproven LP at WATCHLIST (UNKNOWN)', () => {
    const lockedOnly = evaluateSniper(clean({ security: { ...clean().security, lpBurnedPercent: null, lpLockedPercent: 100 } }), { smartMoney: CONFIRMED })
    expect(lockedOnly.status).toBe('SIGNAL')
    // Neither burn nor lock proven by any source → UNKNOWN, not BREACH.
    // The token is not rejected, but it can never become SIGNAL (UNKNOWN ≠ PASS).
    const neither = evaluateSniper(clean({ security: { ...clean().security, lpBurnedPercent: null, lpLockedPercent: null } }), { smartMoney: CONFIRMED })
    expect(neither.status).toBe('WATCHLIST')
    expect(neither.rejections).toEqual([])
    expect(neither.warnings.some((w) => w.includes('LP burn/lock unproven'))).toBe(true)
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

  it('names an unmeasured bundler exit instead of printing it as sold 0%', () => {
    const d = evaluateSniper(clean({
      distribution: { ...clean().distribution, bundlerPercent: 12, bundlerSoldPercent: null },
    }))
    expect(d.status).toBe('REJECT')
    expect(d.rejections.join(' ')).toContain('exit is unproven')
    expect(d.rejections.join(' ')).not.toContain('sold 0%')
  })

  it('keeps an unproven cohort share a rejection and reports the measured exit', () => {
    const unknownExit = evaluateSniper(clean({
      distribution: { ...clean().distribution, bundlerPercent: null, bundlerSoldPercent: null },
    }))
    expect(unknownExit.status).toBe('REJECT')
    expect(unknownExit.rejections).toContain('Bundler share unproven')

    const knownExit = evaluateSniper(clean({
      distribution: { ...clean().distribution, bundlerPercent: null, bundlerSoldPercent: 75 },
    }))
    expect(knownExit.status).toBe('REJECT')
    expect(knownExit.rejections.join(' ')).toContain('launch cohort sold 75%')

    // A proven full exit never erases the unproven share: 100% sold is the
    // rug signature, not a safety proof.
    const fullyDumped = evaluateSniper(clean({
      distribution: { ...clean().distribution, bundlerPercent: null, bundlerSoldPercent: 100 },
    }))
    expect(fullyDumped.status).toBe('REJECT')
    expect(fullyDumped.rejections.join(' ')).toContain('Bundler share unproven')
  })

  it('tolerates bundlers up to 30% only when 100% sold', () => {
    const sold = evaluateSniper(clean({
      distribution: { ...clean().distribution, bundlerPercent: 25, bundlerSoldPercent: 100 },
    }), { smartMoney: CONFIRMED })
    expect(sold.status).toBe('SIGNAL')
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
          topWallets: [
            { address: 'Bad1111111111111111111111111111111111111111', percent: 9, kind },
            { address: 'H21111111111111111111111111111111111111111', percent: 2, kind: 'holder' },
            { address: 'H31111111111111111111111111111111111111111', percent: 1, kind: 'holder' },
          ],
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
        // Every top wallet must respect the operator's single-whale <=5%
        // rule, otherwise the stage profile rejects the fixture before the
        // tail-wallet rule under test is reached.
        topWallets: [
          { address: 'H11111111111111111111111111111111111111111', percent: 4, kind: 'holder' },
          { address: 'H21111111111111111111111111111111111111111', percent: 3, kind: 'holder' },
          { address: 'H31111111111111111111111111111111111111111', percent: 2, kind: 'holder' },
          { address: 'S41111111111111111111111111111111111111111', percent: 1, kind: 'sniper' },
        ],
      },
    }), { smartMoney: CONFIRMED })
    expect(d.status).toBe('SIGNAL')
  })

  it('treats unknown distribution fields as unproven, never safe', () => {
    const d = evaluateSniper(clean({
      distribution: {
        devPercent: null, sniperPercent: null, bundlerPercent: null,
        insiderPercent: null, top10Percent: null, clusterPercent: null,
        topWallets: [],
      },
    }), { smartMoney: CONFIRMED })
    expect(d.status).toBe('REJECT')
    // UNKNOWN must never collapse to 0 / pass: dev, sniper, bundler,
    // insider, top10, cluster, top1-3 = 7 independent UNKNOWN rejections.
    expect(d.rejections.length).toBe(7)
    expect(d.rejections.join(' ')).toContain('Linked cluster unproven')
    expect(d.rejections.join(' ')).toContain('Top 1-3 holder identities unproven')
  })

  it('rejects an unproven honeypot instead of passing it', () => {
    const d = evaluateSniper(clean({
      security: { ...clean().security, honeypot: null },
    }), { smartMoney: CONFIRMED })
    expect(d.status).toBe('REJECT')
    expect(d.rejections.join(' ')).toContain('Honeypot status unproven')
  })

  it('treats an undefined cluster as unproven, not as 0', () => {
    const d = evaluateSniper(clean({
      distribution: { ...clean().distribution, clusterPercent: undefined },
    }), { smartMoney: CONFIRMED })
    expect(d.status).toBe('REJECT')
    expect(d.rejections.join(' ')).toContain('Linked cluster unproven')
  })

  it('passes cluster at the ceiling but rejects one point above', () => {
    const at = evaluateSniper(clean({
      distribution: { ...clean().distribution, clusterPercent: 5 },
    }), { smartMoney: CONFIRMED })
    expect(at.rejections.join(' ')).not.toContain('cluster')
    const over = evaluateSniper(clean({
      distribution: { ...clean().distribution, clusterPercent: 5.1 },
    }), { smartMoney: CONFIRMED })
    expect(over.status).toBe('REJECT')
    expect(over.rejections.join(' ')).toContain('Linked cluster')
  })

  it('keeps a locked-100% LP safe when the burn leg is unproven', () => {
    const d = evaluateSniper(clean({
      security: { ...clean().security, lpLockedPercent: 100, lpBurnedPercent: null },
    }), { smartMoney: CONFIRMED })
    expect(d.rejections.join(' ')).not.toContain('LP')
  })

  it('caps an unproven LP (neither burn nor lock reported) at WATCHLIST, not REJECT', () => {
    const d = evaluateSniper(clean({
      security: { ...clean().security, lpLockedPercent: null, lpBurnedPercent: null },
    }), { smartMoney: CONFIRMED })
    // No source measured either LP leg → UNKNOWN. Not a breach (the token
    // survives), but never a pass (it cannot reach SIGNAL).
    expect(d.status).toBe('WATCHLIST')
    expect(d.rejections).toEqual([])
    expect(d.warnings.some((w) => w.includes('LP burn/lock unproven'))).toBe(true)
  })

  it('rejects a partially-locked LP with an unproven burn leg (lock < 99.5% is a breach)', () => {
    const d = evaluateSniper(clean({
      security: { ...clean().security, lpLockedPercent: 60, lpBurnedPercent: null },
    }), { smartMoney: CONFIRMED })
    // Lock is proven but insufficient; the un-burnt remainder is pullable,
    // so this IS a breach even though burn itself was never measured.
    expect(d.status).toBe('REJECT')
    expect(d.rejections.join(' ')).toContain('LP lock only 60%')
  })
})

describe('meme-sniper momentum gates', () => {
  it('requires 2x vol/mcap for a new pair (<2h)', () => {
    const below = evaluateSniper(clean({ ageMinutes: 30, momentum: { marketCap: 1e6, volume5m: 1.5e6 } }), { smartMoney: CONFIRMED })
    expect(below.status).toBe('REJECT')
    expect(below.rejections.join(' ')).toContain('required 2x')
    expect(evaluateSniper(clean({ ageMinutes: 30, momentum: { marketCap: 1e6, volume5m: 2e6 } }), { smartMoney: CONFIRMED }).status).toBe('SIGNAL')
  })

  it('requires 4x vol/mcap after bonding (>=2h)', () => {
    const below = evaluateSniper(clean({ ageMinutes: 180, momentum: { marketCap: 1e6, volume5m: 3e6 } }), { smartMoney: CONFIRMED })
    expect(below.status).toBe('REJECT')
    expect(below.rejections.join(' ')).toContain('required 4x')
    expect(evaluateSniper(clean({ ageMinutes: 180, momentum: { marketCap: 1e6, volume5m: 4e6 } }), { smartMoney: CONFIRMED }).status).toBe('SIGNAL')
  })

  it('honors an explicit stage over the age heuristic', () => {
    const d = evaluateSniper(clean({ ageMinutes: 30, stage: 'post-bonding', momentum: { marketCap: 1e6, volume5m: 3e6 } }), { smartMoney: CONFIRMED })
    expect(d.status).toBe('REJECT')
  })

  it('rejects a zero market cap instead of dividing by zero', () => {
    const d = evaluateSniper(clean({ momentum: { marketCap: 0, volume5m: 5e6 } }), { smartMoney: CONFIRMED })
    expect(d.status).toBe('REJECT')
    expect(d.metrics.volMcRatio).toBeNull()
    expect(d.rejections.join(' ')).toContain('ratio uncomputable')
  })

  it('reports an unknown volume as unmeasured, never as a 0.00x ratio', () => {
    const d = evaluateSniper(clean({ momentum: { marketCap: 483_685, volume5m: null } }), { smartMoney: CONFIRMED })
    expect(d.status).toBe('REJECT')
    expect(d.metrics.volMcRatio).toBeNull()
    expect(d.rejections.join(' ')).toContain('Volume unknown — momentum uncomputable')
    expect(d.rejections.join(' ')).not.toContain('0.00x')
    expect(d.alert).not.toContain('0.00x')
  })
})

describe('meme-sniper decision protocol', () => {
  it('flags top-holder PnL > +150% as dump risk and downgrades to WATCHLIST', () => {
    const d = evaluateSniper(clean({ momentum: { marketCap: 1e6, volume5m: 3e6, top5AvgPnlPercent: 260 } }), { smartMoney: CONFIRMED })
    expect(d.status).toBe('WATCHLIST')
    expect(d.metrics.pnlAssessment).toBe('dump-risk')
    expect(d.rationale).toContain('wait for the flush')
  })

  it('labels < +50% top-holder PnL as accumulation', () => {
    const d = evaluateSniper(clean({ momentum: { marketCap: 1e6, volume5m: 3e6, top5AvgPnlPercent: 12 } }), { smartMoney: CONFIRMED })
    expect(d.status).toBe('SIGNAL')
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

})

describe('meme-sniper alert safety', () => {
  it('escapes the three Telegram HTML control characters', () => {
    // HTML mode only reserves &, <, > — `_ * [ \`` are literal text and must
    // NOT be backslash-escaped (that renders as visible junk to the operator).
    expect(escapeHtml('a & b <c> d_e*f[1]')).toBe('a &amp; b &lt;c&gt; d_e*f[1]')
  })

  it('neutralizes a ticker/narrative that would break HTML parsing', () => {
    const d = evaluateSniper(clean({
      ticker: 'EVIL<&>x',
      momentum: { marketCap: 1e6, volume5m: 3e6, narrative: 'a&b<c>d' },
    }), { smartMoney: CONFIRMED })
    expect(d.alert).toContain('EVIL&lt;&amp;&gt;x')
    expect(d.alert).toContain('a&amp;b&lt;c&gt;d')
    // No legacy-Markdown escapes and no Markdown bold survive in HTML mode.
    expect(d.alert).not.toContain('\\_')
    expect(d.alert).not.toContain('*VILONA')
  })

  it('states an explicit fallback when no narrative is supplied', () => {
    const d = evaluateSniper(clean({ momentum: { marketCap: 1e6, volume5m: 3e6 } }), { smartMoney: CONFIRMED })
    expect(d.alert).toContain('Belum ada data katalis')
  })
  it('caps a clean setup at WATCHLIST when no wallet confirms it', () => {
    const d = evaluateSniper(clean({ momentum: { marketCap: 1e6, volume5m: 3e6, top5AvgPnlPercent: 12 } }))
    expect(d.status).toBe('WATCHLIST')
    expect(d.rationale).toContain('no verified smart-money buyer')
    // Missing confirmation is not a veto: nothing about the setup is rejected.
    expect(d.rejections).toEqual([])
  })

  it('never emits an execution verdict — the status union has no EXECUTE', () => {
    const d = evaluateSniper(clean(), { smartMoney: CONFIRMED })
    expect(d.status).toBe('SIGNAL')
    expect(d.alert).toContain('SIGNAL')
    expect(d.alert).not.toContain('EXECUTE')
    // No position sizing or exit levels anywhere in the decision or message.
    expect(d).not.toHaveProperty('plan')
    expect(d.alert).not.toContain('Stop Loss')
    expect(d.alert).not.toContain('TP1')
  })

  it('surfaces extra provenance warnings from the caller', () => {
    const d = evaluateSniper(clean({ momentum: { marketCap: 1e6, volume5m: 3e6 } }), {
      extraWarnings: ['birdeye: contract mismatch (BONK ≠ AAA) — audit discarded'],
    })
    expect(d.warnings.some((w) => w.includes('contract mismatch'))).toBe(true)
  })
})

describe('ebook criteria cross-check (opts.criteriaProfiles)', () => {
  it('adds no rejections when the profile is not selected', () => {
    const d = evaluateSniper(clean(), { smartMoney: CONFIRMED })
    expect(d.rejections).toEqual([])
    expect(d.warnings.some((w) => w.startsWith('[golden-new-pairs]'))).toBe(false)
  })

  it('golden-new-pairs rejects bundlers above its 40% ceiling', () => {
    // Inline SNIPER_LIMITS tolerates <=30%; the ebook profile is looser at
    // <=40%, so 35% passes inline but must still be judged by the profile.
    const d = evaluateSniper(
      clean({ distribution: { ...clean().distribution, bundlerPercent: 45 } }),
      { criteriaProfiles: ['golden-new-pairs'] },
    )
    expect(d.rejections.some((r) => r.includes('[golden-new-pairs]'))).toBe(true)
    expect(d.rejections.some((r) => r.includes('Bundlers'))).toBe(true)
  })

  it('sniper-launch rejects dev above its 3% documented ceiling', () => {
    const d = evaluateSniper(
      clean({ distribution: { ...clean().distribution, devPercent: 3.5 } }),
      { criteriaProfiles: ['sniper-launch'] },
    )
    expect(d.status).toBe('REJECT')
    expect(d.rejections.some((r) => r.includes('[sniper-launch]'))).toBe(true)
  })

  it('surfaces profile unknowns as warnings, never as a silent pass', () => {
    const d = evaluateSniper(clean(), { criteriaProfiles: ['golden-post-migrated'] })
    // top5AvgPnlPercent=20 is present, but volume 3x fails the >=4x warn.
    expect(d.warnings.some((w) => w.includes('[golden-post-migrated]'))).toBe(true)
  })

  it('never un-rejects an inline breach', () => {
    const d = evaluateSniper(
      clean({ security: { ...clean().security, mintable: true } }),
      { criteriaProfiles: ['golden-new-pairs'] },
    )
    expect(d.status).toBe('REJECT')
    expect(d.rejections.some((r) => r.includes('Mint authority'))).toBe(true)
  })
})
