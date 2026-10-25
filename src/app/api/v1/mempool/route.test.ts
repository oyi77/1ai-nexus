import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

const { fetchOne } = vi.hoisted(() => ({ fetchOne: vi.fn() }))

vi.mock('@/lib/modules', () => ({
  registerAllModules: () => ({ fetchOne }),
}))

vi.mock('@/lib/api/server-cache', () => ({
  getCached: vi.fn(async (_key: string, _ttl: number, loader: () => Promise<unknown>) => ({
    data: await loader(),
    fromCache: false,
  })),
}))

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('mempool whale content', () => {
  it('fails closed when the unconfirmed-transaction source is unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, { data: { tickers: [{ symbol: 'BTC', price: '$80,000' }] } }))
      .mockResolvedValueOnce(response(503, {}))
    vi.stubGlobal('fetch', fetchMock)

    const res = await GET(new Request('http://localhost/api/v1/mempool?action=whale'))

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({
      data: null,
      error: 'Unconfirmed transaction source returned HTTP 503',
    })
  })

  it('renders only unconfirmed whales with finite metrics and no invented fee data', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_030_000)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, { data: { tickers: [{ symbol: 'BTC', price: '$80,000' }] } }))
      .mockResolvedValueOnce(response(200, {
        txs: [
          { hash: 'small', out: [{ value: 100_000_000 }], weight: 500, fee: 100 },
          { hash: 'whale', out: [{ value: 600_000_000 }, { value: 400_000_000 }], weight: 5000, fee: 4000, time: 1_700_000_000 },
          { hash: 'missing-fee', out: [{ value: 2_000_000_000 }], weight: 0, time: 1_700_000_000 },
        ],
      }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await GET(new Request('http://localhost/api/v1/mempool?action=whale'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.error).toBeNull()
    expect(body.data.count).toBe(2)
    expect(body.data.source).toBe('blockchain.info')
    expect(body.data.transactions[0]).toMatchObject({
      txid: 'missing-fee',
      valueBtc: 20,
      valueUsd: 1_600_000,
      fee: null,
      vsize: null,
      rate: null,
      age: 30,
    })
    expect(body.data.transactions[1]).toMatchObject({
      txid: 'whale',
      valueBtc: 10,
      valueUsd: 800_000,
      fee: 4000,
      vsize: 1250,
      rate: 3.2,
      age: 30,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toBe('https://blockchain.info/unconfirmed-transactions?format=json')
  })
})
