import { describe, expect, it } from 'vitest'
import {
  buildKolAxiomDigest,
  KOL_MONITOR_LABELS,
  toMonitoredWallet,
  type MonitoredWallet,
} from '../wallet-persist'

describe('toMonitoredWallet', () => {
  it('tags axiom wallets with axiom + kol-monitor labels', () => {
    const w: MonitoredWallet = toMonitoredWallet('D'.repeat(40), 'axiom')
    expect(w.address).toBe('D'.repeat(40))
    expect(w.chain).toBe('solana')
    expect(w.alias).toBeNull()
    expect(w.labels).toEqual(['axiom', 'kol-monitor'])
  })

  it('tags kolscan wallets with kolscan + kol-monitor labels and keeps alias', () => {
    const w: MonitoredWallet = toMonitoredWallet('E'.repeat(40), 'kolscan', 'Kang Rug')
    expect(w.labels).toEqual(['kolscan', 'kol-monitor'])
    expect(w.alias).toBe('Kang Rug')
  })

  it('exposes label constants for both sources', () => {
    expect(KOL_MONITOR_LABELS.axiom).toEqual(['axiom', 'kol-monitor'])
    expect(KOL_MONITOR_LABELS.kolscan).toEqual(['kolscan', 'kol-monitor'])
  })
})

describe('buildKolAxiomDigest', () => {
  const base = {
    axiom: [],
    kolscan: [],
  }

  it('returns null when both sources are empty', () => {
    expect(buildKolAxiomDigest(base)).toBeNull()
  })

  it('formats KOLScan buys with token symbol, rounded USD, and dex', () => {
    const out = buildKolAxiomDigest({
      ...base,
      kolscan: [
        {
          kolName: 'Kang Rug',
          outTokenSymbol: 'TOK',
          outTokenAddress: 'E'.repeat(40),
          usdValue: 1600.4,
          dex: 'Pump.fun',
        },
      ],
    })
    expect(out).toContain('📡 <b>SMART MONEY / KOL RADAR</b>')
    expect(out).toContain('━━━━━━━━━━━━━━━━━━━━━━━━━')
    expect(out).toContain('• <b>Kang Rug</b> bought <b>$TOK</b> (<b>$1,600</b> · Pump.fun)')
    expect(out).toContain(`  └ CA: <code>${'E'.repeat(40)}</code>`)
  })

  it('falls back to the first 8 address chars when the token symbol is empty', () => {
    const addr = 'AbCdEfGh123456'
    const out = buildKolAxiomDigest({
      ...base,
      kolscan: [
        {
          kolName: 'kol',
          outTokenSymbol: '',
          outTokenAddress: addr,
          usdValue: 900.4,
          dex: 'Raydium',
        },
      ],
    })
    expect(out).toContain(`• <b>kol</b> bought <b>$${addr.slice(0, 8)}</b> (<b>$900</b> · Raydium)`)
    expect(out).toContain(`  └ CA: <code>${addr}</code>`)
  })

  it('renders n/a when usdValue is null', () => {
    const out = buildKolAxiomDigest({
      ...base,
      kolscan: [
        {
          kolName: 'kol',
          outTokenSymbol: 'TOK',
          outTokenAddress: 'E'.repeat(40),
          usdValue: null,
          dex: 'Jupiter',
        },
      ],
    })
    expect(out).toContain('• <b>kol</b> bought <b>$TOK</b> (n/a · Jupiter)')
    expect(out).toContain(`  └ CA: <code>${'E'.repeat(40)}</code>`)
  })

  it('formats Axiom wallets with short address, win rate, and signed pnl', () => {
    const out = buildKolAxiomDigest({
      ...base,
      axiom: [
        { address: 'D'.repeat(40), winRate30d: 0.666, pnl30d: 0.42 },
        { address: 'E'.repeat(40), winRate30d: null, pnl30d: -0.03 },
      ],
    })
    expect(out).toContain(`• <code>${'D'.repeat(40).slice(0, 8)}…</code> — WR 67% · PnL +42%`)
    expect(out).toContain(`• <code>${'E'.repeat(40).slice(0, 8)}…</code> — WR n/a · PnL -3%`)
  })

  it('caps both sources at 5 rows', () => {
    const out = buildKolAxiomDigest({
      axiom: Array.from({ length: 9 }, (_, i) => ({
        address: String.fromCharCode(65 + i).repeat(40),
        winRate30d: 0.6,
        pnl30d: 0.1,
      })),
      kolscan: Array.from({ length: 9 }, (_, i) => ({
        kolName: `kol${i}`,
        outTokenSymbol: 'TOK',
        outTokenAddress: 'E'.repeat(40),
        usdValue: 1000,
        dex: 'Pump.fun',
      })),
    })
    const kolscanRows = out!.split('\n').filter((l) => l.startsWith('• ') && l.includes('kol'))
    const axiomRows = out!.split('\n').filter((l) => l.startsWith('• ') && l.includes('WR'))
    expect(kolscanRows).toHaveLength(5)
    expect(axiomRows).toHaveLength(5)
    expect(out!.length).toBeLessThan(4096)
  })

  it('escapes HTML control characters in dynamic names', () => {
    const out = buildKolAxiomDigest({
      ...base,
      kolscan: [
        {
          kolName: 'Kang <Rug> & Co',
          outTokenSymbol: 'TOK',
          outTokenAddress: 'E'.repeat(40),
          usdValue: 1000,
          dex: 'Pump.fun',
        },
      ],
    })
    expect(out).toContain('Kang &lt;Rug&gt; &amp; Co')
  })
})
