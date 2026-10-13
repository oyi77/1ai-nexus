import { describe, expect, it } from 'vitest'
import { axiomWalletToSheetRow, kolscanTxToSheetRow } from '../sheet-export'
import type { AxiomWallet } from '../axiom-monitor'
import type { KolscanTransaction } from '../kolscan'

function axiomWallet(over: Partial<AxiomWallet> = {}): AxiomWallet {
  return {
    address: 'D'.repeat(40),
    name: null,
    tags: [],
    winRate30d: 0.666,
    pnl30d: 0.42,
    realizedProfit30d: null,
    buyCount30d: null,
    sellCount30d: null,
    fastTxRatio: null,
    isHuman: true,
    humanReason: 'test',
    ...over,
  }
}

function kolscanTx(over: Partial<KolscanTransaction> = {}): KolscanTransaction {
  return {
    signature: 'sig',
    walletAddress: 'E'.repeat(40),
    kolName: 'Kang Rug',
    timestamp: 1,
    solChange: 10,
    outTokenSymbol: 'TOK',
    outTokenAddress: 'F'.repeat(40),
    outAmount: 1000,
    inTokenSymbol: null,
    inTokenAddress: null,
    inAmount: 0,
    dex: 'Pump.fun',
    usdValue: 1600.4,
    ...over,
  }
}

describe('axiomWalletToSheetRow', () => {
  it('formats winrate (0dp) and signed pnl (0dp)', () => {
    const row = axiomWalletToSheetRow(axiomWallet())
    expect(row.address).toBe('D'.repeat(40))
    expect(row.name).toBe('AXIOM wr=67% pnl=+42%')
  })

  it('handles negative pnl with explicit sign', () => {
    expect(axiomWalletToSheetRow(axiomWallet({ pnl30d: -0.03 })).name).toBe('AXIOM wr=67% pnl=-3%')
  })

  it('renders n/a for null winrate and pnl', () => {
    const row = axiomWalletToSheetRow(axiomWallet({ winRate30d: null, pnl30d: null }))
    expect(row.name).toBe('AXIOM wr=n/a pnl=n/a')
  })
})

describe('kolscanTxToSheetRow', () => {
  it('formats kolName, token symbol, and rounded USD', () => {
    const row = kolscanTxToSheetRow(kolscanTx())
    expect(row.address).toBe('E'.repeat(40))
    expect(row.name).toBe('KOLSCAN Kang Rug TOK $1600')
  })

  it('falls back to the first 8 address chars when tokenSymbol is empty', () => {
    const addr = 'AbCdEfGh123456'
    const row = kolscanTxToSheetRow(kolscanTx({ outTokenSymbol: '', outTokenAddress: addr }))
    expect(row.name).toBe(`KOLSCAN Kang Rug ${addr.slice(0, 8)} $1600`)
  })

  it('renders n/a when usdValue is null', () => {
    const row = kolscanTxToSheetRow(kolscanTx({ usdValue: null }))
    expect(row.name).toBe('KOLSCAN Kang Rug TOK n/a')
  })
})
