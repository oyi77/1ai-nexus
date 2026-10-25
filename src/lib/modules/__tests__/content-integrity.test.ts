import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET as getDexTrending } from '@/app/api/v1/dex/trending/route'
import { getOkxTickers } from '../market/multi-exchange'

afterEach(() => {
  vi.unstubAllGlobals()
})
describe('rendered content integrity', () => {
  it('normalizes CoinGecko formatted USD values to numbers', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const body = url.includes('coingecko.com')
        ? { coins: [{ item: { name: 'Hyperliquid', symbol: 'HYPE', data: { price: 40, market_cap: '$17,023,050,401', total_volume: '$738,133,170', price_change_percentage_24h: { usd: -0.8 } } } }] }
        : { data: [] }
      return { ok: true, status: 200, json: async () => body } as Response
    }))

    const response = await getDexTrending(new Request('http://localhost/api/v1/dex/trending'))
    const payload = await response.json()
    const item = payload.data.items[0]
    expect(item).toMatchObject({ name: 'Hyperliquid', symbol: 'HYPE', source: 'coingecko' })
    for (const value of [item.fdv, item.volume24h]) {
      expect(typeof value).toBe('number')
      expect(Number.isFinite(value)).toBe(true)
      expect(value).toBeGreaterThan(0)
    }
  })

  it('uses OKX base-currency volume instead of contract count', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ instId: 'BTC-USDT-SWAP', last: '80000', sodUtc8: '79000', vol24h: '50000', volCcy24h: '500', high24h: '81000', low24h: '78000' }] }),
    } as Response)))

    const [ticker] = await getOkxTickers()
    expect(ticker.volume24h).toBe(500)
    expect(ticker.volume24h * ticker.price).toBe(40_000_000)
  })
})
