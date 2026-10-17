import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import {
  parseKolscanWallets,
  parseKolscanTransactions,
  screenKolscanTransactions,
  resolveKolscanThresholds,
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

describe('resolveKolscanThresholds', () => {
  it('returns hardcoded defaults when env is empty', () => {
    const t = resolveKolscanThresholds({})
    expect(t.minPurchaseUsd).toBe(1000)
    expect(t.minWinRate).toBe(0.6)
  })

  it('honors KOLSCAN_MIN_PURCHASE_USD override', () => {
    const t = resolveKolscanThresholds({ KOLSCAN_MIN_PURCHASE_USD: '500' })
    expect(t.minPurchaseUsd).toBe(500)
    expect(t.minWinRate).toBe(0.6)
  })

  it('honors KOLSCAN_MIN_WINRATE override', () => {
    const t = resolveKolscanThresholds({ KOLSCAN_MIN_WINRATE: '0.75' })
    expect(t.minPurchaseUsd).toBe(1000)
    expect(t.minWinRate).toBe(0.75)
  })

  it('honors win rate of 0 (disable win-rate filter)', () => {
    const t = resolveKolscanThresholds({ KOLSCAN_MIN_WINRATE: '0' })
    expect(t.minWinRate).toBe(0)
  })

  it('falls back to defaults for invalid values', () => {
    const t = resolveKolscanThresholds({
      KOLSCAN_MIN_PURCHASE_USD: 'abc',
      KOLSCAN_MIN_WINRATE: 'not-a-number',
    })
    expect(t.minPurchaseUsd).toBe(1000)
    expect(t.minWinRate).toBe(0.6)
  })

  it('falls back for negative purchase USD', () => {
    const t = resolveKolscanThresholds({ KOLSCAN_MIN_PURCHASE_USD: '-100' })
    expect(t.minPurchaseUsd).toBe(1000)
  })

  it('falls back for win rate > 1', () => {
    const t = resolveKolscanThresholds({ KOLSCAN_MIN_WINRATE: '1.5' })
    expect(t.minWinRate).toBe(0.6)
  })

  it('honors both overrides simultaneously', () => {
    const t = resolveKolscanThresholds({
      KOLSCAN_MIN_PURCHASE_USD: '2500',
      KOLSCAN_MIN_WINRATE: '0.55',
    })
    expect(t.minPurchaseUsd).toBe(2500)
    expect(t.minWinRate).toBe(0.55)
  })

  it('treats empty string as unset', () => {
    const t = resolveKolscanThresholds({
      KOLSCAN_MIN_PURCHASE_USD: '',
      KOLSCAN_MIN_WINRATE: '',
    })
    expect(t.minPurchaseUsd).toBe(1000)
    expect(t.minWinRate).toBe(0.6)
  })
})

// `fetchSolPriceUsd` memoises a 5-minute SOL price at module scope, so a static
// `fetchKolscanFeed` import would leak that cache across cases. Each case
// therefore reloads a fresh module registry via `await import('../index')`
// (this also picks up per-test `process.env` stubs). Static import cannot work.
describe('fetchKolscanFeed', () => {
  const SOL_MINT = 'So11111111111111111111111111111111111111112'
  const ADDR_A = 'A'.repeat(40)
  const ADDR_B = 'B'.repeat(40)
  const MINT_X = 'X'.repeat(40)
  const EVM_A = `0x${'b'.repeat(40)}`
  const HTM_SIG = '3'.repeat(64)

  type FetchInit = { headers?: Record<string, string> }
  type FetchLike = (url: string, init?: FetchInit) => Promise<unknown>

  const calls: Array<{ url: string; init?: FetchInit }> = []
  let fetchMock: Mock<FetchLike>

  function jsonRes(body: unknown, ok = true) {
    return { ok, status: ok ? 200 : 500, json: async () => body, text: async () => JSON.stringify(body) }
  }

  function htmlRes(html: string, ok = true) {
    return { ok, status: ok ? 200 : 500, text: async () => html, json: async () => ({}) }
  }

  function walletJson(address: string, name: string, evm: string | null): string {
    return (
      `{"wallet_address":"${address}","name":"${name}",` +
      `"twitter":null,"telegram":null,` +
      `"evm_address":${evm === null ? 'null' : `"${evm}"`},` +
      `"pfp":"https://img/${address}","transactions":[`
    )
  }

  function txJson(signature: string, address: string, solChange: number, kolName: string): string {
    return (
      `{"signature":"${signature}","wallet_address":"${address}",` +
      `"timestamp":1700000000,"sol_change":${solChange},` +
      `"out_token_symbol":"TOK","out_token_address":"${MINT_X}","out_amount":1000,` +
      `"in_token_symbol":"SOL","in_token_address":"${SOL_MINT}","in_amount":${solChange},` +
      `"dex":"Pump.fun","name":"${kolName}","pfp":"https://img/x"}`
    )
  }

  const supaWalletRows = [
    { wallet_address: ADDR_A, name: 'Alice', twitter: null, telegram: null, evm_address: null, pfp: null },
  ]

  function supaTxRow(signature: string, solChange: number) {
    return {
      signature,
      wallet_address: ADDR_A,
      name: 'Alice',
      timestamp: 1700000000,
      sol_change: solChange,
      out_token_symbol: 'TOK',
      out_token_address: MINT_X,
      out_amount: 1000,
      in_token_symbol: 'SOL',
      in_token_address: SOL_MINT,
      in_amount: solChange,
      dex: 'Pump.fun',
    }
  }

  beforeEach(() => {
    delete process.env.KOLSCAN_SESSION
    calls.length = 0
    fetchMock = vi.fn(async (url: string, init?: FetchInit) => {
      calls.push({ url, init })
      return htmlRes('')
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.resetModules()
    delete process.env.KOLSCAN_SESSION
  })

  it('reads the keyless Supabase roster + feed and prices txs in USD from one SOL price', async () => {
    fetchMock.mockImplementation(async (url: string, init?: FetchInit) => {
      calls.push({ url, init })
      if (url.includes('/rest/v1/wallets')) return jsonRes(supaWalletRows)
      if (url.includes('/rest/v1/transactions_realtime')) {
        // Same signature twice: the merge must dedupe to a single tx.
        return jsonRes([supaTxRow('SIG_ONE', 2), supaTxRow('SIG_ONE', 2)])
      }
      if (url.includes('lite-api.jup.ag')) return jsonRes({ [SOL_MINT]: { usdPrice: 150 } })
      if (url.includes('kolscan.io')) return htmlRes(rscHtml(''))
      throw new Error(`unexpected fetch: ${url}`)
    })

    const { fetchKolscanFeed: feed } = await import('../index')
    const result = await feed()

    expect(result.wallets).toHaveLength(1)
    expect(result.wallets[0].address).toBe(ADDR_A)
    expect(result.transactions).toHaveLength(1)
    expect(result.transactions[0].signature).toBe('SIG_ONE')
    expect(result.transactions[0].usdValue).toBe(300)
    expect(Number.isNaN(Date.parse(result.fetchedAt))).toBe(false)
  })

  it('falls back to the RSC HTML payload when Supabase is unavailable', async () => {
    const html = rscHtml(walletJson(ADDR_B, 'Bob', null) + txJson(HTM_SIG, ADDR_B, 1, 'Bob'))
    fetchMock.mockImplementation(async (url: string, init?: FetchInit) => {
      calls.push({ url, init })
      if (url.includes('/rest/v1/')) return jsonRes([], false)
      if (url.includes('lite-api.jup.ag')) return jsonRes({ [SOL_MINT]: { usdPrice: 150 } })
      if (url.includes('kolscan.io')) return htmlRes(html)
      throw new Error(`unexpected fetch: ${url}`)
    })

    const { fetchKolscanFeed: feed } = await import('../index')
    const result = await feed()

    expect(result.wallets.map((w) => w.address)).toEqual([ADDR_B])
    expect(result.transactions).toHaveLength(1)
    expect(result.transactions[0].signature).toBe(HTM_SIG)
    expect(result.transactions[0].usdValue).toBe(150)
  })

  it('sends no Cookie header without KOLSCAN_SESSION, and sends it when set', async () => {
    fetchMock.mockImplementation(async (url: string, init?: FetchInit) => {
      calls.push({ url, init })
      if (url.includes('/rest/v1/')) return jsonRes([])
      if (url.includes('lite-api.jup.ag')) return jsonRes({ [SOL_MINT]: { usdPrice: 150 } })
      if (url.includes('kolscan.io')) return htmlRes(rscHtml(walletJson(ADDR_A, 'Alice', null)))
      throw new Error(`unexpected fetch: ${url}`)
    })

    const { fetchKolscanFeed: feed } = await import('../index')

    delete process.env.KOLSCAN_SESSION
    await feed()
    const keyless = calls.find((c) => c.url.includes('kolscan.io'))
    expect(keyless).toBeDefined()
    expect(keyless?.init?.headers?.Cookie).toBeUndefined()

    calls.length = 0
    process.env.KOLSCAN_SESSION = 'tok-123'
    await feed()
    const withCookie = calls.find((c) => c.url.includes('kolscan.io'))
    expect(withCookie?.init?.headers?.Cookie).toBe('user-session=tok-123')
  })

  it('merges keyless + HTML wallets by address, taking evmAddress from the RSC payload', async () => {
    const html = rscHtml(walletJson(ADDR_A, '', EVM_A))
    fetchMock.mockImplementation(async (url: string, init?: FetchInit) => {
      calls.push({ url, init })
      if (url.includes('/rest/v1/wallets')) return jsonRes(supaWalletRows)
      if (url.includes('/rest/v1/transactions_realtime')) return jsonRes([])
      if (url.includes('lite-api.jup.ag')) return jsonRes({ [SOL_MINT]: { usdPrice: 150 } })
      if (url.includes('kolscan.io')) return htmlRes(html)
      throw new Error(`unexpected fetch: ${url}`)
    })

    const { fetchKolscanFeed: feed } = await import('../index')
    const result = await feed()

    expect(result.wallets).toHaveLength(1)
    expect(result.wallets[0].address).toBe(ADDR_A)
    expect(result.wallets[0].name).toBe('Alice')
    expect(result.wallets[0].evmAddress).toBe(EVM_A)
    expect(result.wallets[0].pfp).toBe(`https://img/${ADDR_A}`)
  })

  it('returns the empty feed shape only when every source fails', async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error('network down')
    })

    const { fetchKolscanFeed: feed } = await import('../index')
    const result = await feed()

    expect(result.wallets).toEqual([])
    expect(result.transactions).toEqual([])
    expect(Number.isNaN(Date.parse(result.fetchedAt))).toBe(false)
  })
})
