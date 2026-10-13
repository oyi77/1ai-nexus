import { describe, it, expect } from 'vitest'
import {
  parseKolscanWallets,
  parseKolscanTransactions,
  screenKolscanTransactions,
  KOLSCAN_THRESHOLDS,
  type KolscanTransaction,
} from '../index'

// A minimal RSC-shaped HTML fixture: two wallet objects and two transactions.
function rscHtml(payload: string): string {
  const escaped = JSON.stringify(payload).slice(1, -1)
  return `<html><script>self.__next_f.push([1,"${escaped}"])</script></html>`
}

describe('parseKolscanWallets', () => {
  it('parses wallet rows with twitter/telegram/evm fields', () => {
    const payload =
      '[{"wallet_address":"' + 'A'.repeat(40) + '","name":"Alpha","pfp":null,' +
      '"telegram":null,"twitter":"https://x.com/alpha","evm_address":"0x' + 'a'.repeat(40) + '","transactions":[]},' +
      '{"wallet_address":"' + 'B'.repeat(40) + '","name":"Beta","pfp":"https://img/x.png",' +
      '"telegram":"https://t.me/beta","twitter":"https://x.com/beta","evm_address":null,"transactions":[]}]'
    const wallets = parseKolscanWallets(rscHtml(payload))
    expect(wallets).toHaveLength(2)
    expect(wallets[0].address).toBe('A'.repeat(40))
    expect(wallets[0].name).toBe('Alpha')
    expect(wallets[0].twitter).toBe('https://x.com/alpha')
    expect(wallets[0].evmAddress).toBe('0x' + 'a'.repeat(40))
    expect(wallets[1].telegram).toBe('https://t.me/beta')
    expect(wallets[1].evmAddress).toBeNull()
  })

  it('dedupes repeated wallet addresses', () => {
    const addr = 'C'.repeat(40)
    const payload =
      '[{"wallet_address":"' + addr + '","name":"X","pfp":null,"telegram":null,"twitter":null,"evm_address":null,"transactions":[]},' +
      '{"wallet_address":"' + addr + '","name":"X","pfp":null,"telegram":null,"twitter":null,"evm_address":null,"transactions":[]}]'
    expect(parseKolscanWallets(rscHtml(payload))).toHaveLength(1)
  })

  it('returns [] for a payload with no wallet rows', () => {
    expect(parseKolscanWallets(rscHtml('[]'))).toEqual([])
  })
})

describe('parseKolscanTransactions', () => {
  const sig = '4'.repeat(64)
  const wallet = 'D'.repeat(40)
  const mint = 'E'.repeat(40)
  const payload =
    '[{"signature":"' + sig + '","wallet_address":"' + wallet + '",' +
    '"timestamp":1791913858,"sol_change":2.001015,' +
    '"out_token_symbol":"CDM","out_token_address":"' + mint + '","out_amount":22836140,' +
    '"in_token_symbol":"","in_token_address":"","in_amount":0,' +
    '"dex":"Pump.fun","name":"EustazZ","pfp":null}]'

  it('parses a transaction row with all fields', () => {
    const txs = parseKolscanTransactions(rscHtml(payload))
    expect(txs).toHaveLength(1)
    const t = txs[0]
    expect(t.signature).toBe(sig)
    expect(t.walletAddress).toBe(wallet)
    expect(t.timestamp).toBe(1791913858)
    expect(t.solChange).toBeCloseTo(2.001015)
    expect(t.outTokenSymbol).toBe('CDM')
    expect(t.outTokenAddress).toBe(mint)
    expect(t.outAmount).toBe(22836140)
    expect(t.dex).toBe('Pump.fun')
    expect(t.kolName).toBe('EustazZ')
    expect(t.inTokenSymbol).toBeNull()
    expect(t.inTokenAddress).toBeNull()
  })

  it('returns [] when no transaction rows are present', () => {
    expect(parseKolscanTransactions(rscHtml('[]'))).toEqual([])
  })
})

describe('screenKolscanTransactions', () => {
  function tx(over: Partial<KolscanTransaction> = {}): KolscanTransaction {
    return {
      signature: 'sig',
      walletAddress: 'wallet',
      kolName: 'kol',
      timestamp: 1,
      solChange: 10,
      outTokenSymbol: 'TOK',
      outTokenAddress: 'mint',
      outAmount: 1000,
      inTokenSymbol: null,
      inTokenAddress: null,
      inAmount: 0,
      dex: 'Pump.fun',
      usdValue: 1600,
      ...over,
    }
  }

  it('keeps a >$1000 buy from a >=60% wallet', () => {
    const wr = new Map([['wallet', 0.7]])
    const out = screenKolscanTransactions([tx()], { winRates: wr })
    expect(out).toHaveLength(1)
    expect(out[0].screenReason).toContain('purchase $1600')
  })

  it('drops buys below the $1000 threshold', () => {
    const wr = new Map([['wallet', 0.7]])
    expect(screenKolscanTransactions([tx({ usdValue: 999 })], { winRates: wr })).toHaveLength(0)
  })

  it('drops a null usdValue (unpriced) buy', () => {
    const wr = new Map([['wallet', 0.7]])
    expect(screenKolscanTransactions([tx({ usdValue: null })], { winRates: wr })).toHaveLength(0)
  })

  it('drops a wallet whose win rate is below 60%', () => {
    const wr = new Map([['wallet', 0.55]])
    expect(screenKolscanTransactions([tx()], { winRates: wr })).toHaveLength(0)
  })

  it('drops a wallet with no known win rate (never pass by omission)', () => {
    expect(screenKolscanTransactions([tx()], { winRates: new Map() })).toHaveLength(0)
  })

  it('drops coordinated replica amounts across >=3 distinct wallets', () => {
    const wr = new Map([['w1', 0.7], ['w2', 0.7], ['w3', 0.7]])
    const txs = [
      tx({ walletAddress: 'w1', outTokenAddress: 'mint', outAmount: 500 }),
      tx({ walletAddress: 'w2', outTokenAddress: 'mint', outAmount: 500 }),
      tx({ walletAddress: 'w3', outTokenAddress: 'mint', outAmount: 500 }),
    ]
    expect(screenKolscanTransactions(txs, { winRates: wr })).toHaveLength(0)
  })

  it('keeps a replica amount when only 2 wallets share it', () => {
    const wr = new Map([['w1', 0.7], ['w2', 0.7]])
    const txs = [
      tx({ walletAddress: 'w1', outTokenAddress: 'mint', outAmount: 500 }),
      tx({ walletAddress: 'w2', outTokenAddress: 'mint', outAmount: 500 }),
    ]
    expect(screenKolscanTransactions(txs, { winRates: wr })).toHaveLength(2)
  })

  it('sorts survivors by descending USD value', () => {
    const wr = new Map([['w1', 0.7], ['w2', 0.7]])
    const txs = [
      tx({ walletAddress: 'w1', outTokenAddress: 'm1', outAmount: 1, usdValue: 1200 }),
      tx({ walletAddress: 'w2', outTokenAddress: 'm2', outAmount: 2, usdValue: 9000 }),
    ]
    const out = screenKolscanTransactions(txs, { winRates: wr })
    expect(out.map((t) => t.walletAddress)).toEqual(['w2', 'w1'])
  })

  it('exposes the operator defaults', () => {
    expect(KOLSCAN_THRESHOLDS.minPurchaseUsd).toBe(1000)
    expect(KOLSCAN_THRESHOLDS.minWinRate).toBe(0.6)
  })
})
