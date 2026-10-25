import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import { getScreenerSnapshot } from '@/lib/modules/market/provider/idx-screener'

vi.mock('@/lib/config/universe', () => ({
  SCREENER_STOCKS: [],
}))

vi.mock('@/lib/modules/market/provider/idx-universe', () => ({
  getIdxUniverse: vi.fn(async () => ({
    stocks: Array.from({ length: 843 }, (_, i) => ({
      symbol: `S${String(i).padStart(3, '0')}.JK`,
      name: `Stock ${i}`,
      sector: 'Financial',
      exchange: 'IDX',
    })),
  })),
}))

vi.mock('@/lib/modules/market/provider/idx-screener', () => ({
  getScreenerSnapshot: vi.fn(async () => ({
    capturedAt: '2026-10-24',
    source: 'prisma:IdxScreenerSnapshot',
    total: 2,
    count: 2,
    data: Object.fromEntries(Array.from({ length: 843 }, (_, i) => {
      const symbol = `S${String(i).padStart(3, '0')}`
      return [symbol, {
        symbol,
        name: `Stock ${i}`,
        sector: 'Financial',
        price: i === 0 ? 8000 : 4000,
        change1d: i === 0 ? 1.25 : -0.5,
        marketCap: i === 0 ? 1_600_000_000_000 : i === 1 ? 800_000_000_000 : 1_000_000_000,
        volume: i === 1 ? 2000 : 1000,
        per: i === 0 ? 12 : 8,
      }]
    })),
  })),
}))

function quoteResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GET /api/v1/screener bounded quotes', () => {
  it('does not fetch all 843 IDX symbols for limit=5 and reports snapshot-ranked scope', async () => {
    let requested: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      requested = (url.searchParams.get('symbols') ?? '').split(',')
      return quoteResponse({ data: requested.map(symbol => ({ symbol })) })
    }))

    const response = await GET(new NextRequest('http://localhost/api/v1/screener?exchange=IDX&limit=5'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.results).toHaveLength(5)
    expect(requested).toHaveLength(51)
    expect(requested).not.toContain('S842.JK')
    expect(body.data.quoteScope).toEqual({ mode: 'snapshot-ranked', considered: 50, available: 843 })
  })

  it('serves limit=200 from 400 stock quote candidates plus FX without expanding to 843', async () => {
    let requested: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      requested = (url.searchParams.get('symbols') ?? '').split(',')
      return quoteResponse({ data: requested.map(symbol => ({ symbol })) })
    }))

    const response = await GET(new NextRequest('http://localhost/api/v1/screener?exchange=IDX&limit=200'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.results).toHaveLength(200)
    expect(requested).toHaveLength(401)
    expect(requested.filter(symbol => symbol.endsWith('.JK'))).toHaveLength(400)
    expect(body.data.quoteScope).toEqual({ mode: 'snapshot-ranked', considered: 400, available: 843 })
  })

  it('sorts deterministically by value then symbol within the snapshot-ranked scope', async () => {
    let requested: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      requested = (url.searchParams.get('symbols') ?? '').split(',')
      return quoteResponse({ data: requested.map(symbol => ({ symbol, regularMarketVolume: 10 })) })
    }))

    const request = () => GET(new NextRequest('http://localhost/api/v1/screener?exchange=IDX&limit=5&sortBy=volume'))
    const first = await (await request()).json()
    const second = await (await request()).json()

    expect(first.data.results.map((row: { symbol: string }) => row.symbol)).toEqual([
      'S000.JK', 'S001.JK', 'S002.JK', 'S003.JK', 'S004.JK',
    ])
    expect(second.data.results).toEqual(first.data.results)
  })

  it('includes a snapshot-ranked winner beyond the old 200-symbol boundary', async () => {
    const snapshot = await getScreenerSnapshot()
    vi.mocked(getScreenerSnapshot).mockResolvedValueOnce({
      ...snapshot,
      data: { ...snapshot.data, S500: { ...snapshot.data.S500, marketCap: 999_000_000_000_000 } },
    })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      const symbols = (url.searchParams.get('symbols') ?? '').split(',')
      return quoteResponse({ data: symbols.map(symbol => ({
        symbol,
        currency: 'USD',
        marketCap: symbol === 'S500.JK' ? 999_000_000_000 : 1,
      })) })
    }))

    const response = await GET(new NextRequest('http://localhost/api/v1/screener?exchange=IDX&limit=5'))
    const body = await response.json()

    expect(body.data.results[0]).toMatchObject({ symbol: 'S500.JK', marketCap: 999_000_000_000 })
    expect(body.data.quoteScope).toEqual({ mode: 'snapshot-ranked', considered: 50, available: 843 })
  })

  it('uses snapshot fundamentals and FX instead of expanding quote filters to 843 symbols', async () => {
    const requests: string[][] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      const symbols = (url.searchParams.get('symbols') ?? '').split(',')
      requests.push(symbols)
      return quoteResponse({ data: symbols.map(symbol => ({ symbol, marketCap: 100, regularMarketPrice: symbol === 'IDRUSD=X' ? 0.0000625 : undefined })) })
    }))

    const response = await GET(new NextRequest('http://localhost/api/v1/screener?exchange=IDX&limit=5&minMarketCap=1&maxPE=10'))
    const body = await response.json()

    expect(requests).toHaveLength(2)
    expect(requests[0]).toEqual(['IDRUSD=X'])
    expect(requests[1]).toHaveLength(51)
    expect(body.data.quoteScope).toEqual({ mode: 'snapshot-ranked', considered: 50, available: 843 })
  })

  it('prefilters low IDR snapshot caps against a USD threshold while retaining a qualifying late row', async () => {
    const snapshot = await getScreenerSnapshot()
    vi.mocked(getScreenerSnapshot).mockResolvedValueOnce({
      ...snapshot,
      data: {
        ...snapshot.data,
        S000: { ...snapshot.data.S000, marketCap: 1_000_000 },
        S001: { ...snapshot.data.S001, marketCap: 1_000_000 },
        S500: { ...snapshot.data.S500, marketCap: 999_000_000_000_000 },
      },
    })
    const requests: string[][] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      const symbols = (url.searchParams.get('symbols') ?? '').split(',')
      requests.push(symbols)
      return quoteResponse({ data: symbols.map(symbol => ({
        symbol,
        regularMarketPrice: symbol === 'IDRUSD=X' ? 0.0000625 : undefined,
        marketCap: symbol === 'S500.JK' ? 999_000_000_000 : 1,
        currency: 'USD',
      })) })
    }))

    const response = await GET(new NextRequest('http://localhost/api/v1/screener?exchange=IDX&limit=5&minMarketCap=1000000'))
    const body = await response.json()

    expect(requests).toHaveLength(2)
    expect(requests[0]).toEqual(['IDRUSD=X'])
    expect(requests[1].filter(symbol => symbol.endsWith('.JK'))).toHaveLength(1)
    expect(body.data.results[0]).toMatchObject({ symbol: 'S500.JK', marketCap: 999_000_000_000 })
    expect(body.data.quoteScope).toEqual({ mode: 'snapshot-ranked', considered: 1, available: 843 })
  })
  it('preserves IDX snapshot fundamentals when chart quotes omit market cap and PE', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const symbols = (new URL(String(input)).searchParams.get('symbols') ?? '').split(',')
      return quoteResponse({ data: symbols.map(symbol => ({
        symbol,
        currency: symbol === 'IDRUSD=X' ? 'USD' : 'IDR',
        regularMarketPrice: symbol === 'IDRUSD=X' ? 0.0000625 : 4000,
      })) })
    }))

    const response = await GET(new NextRequest('http://localhost/api/v1/screener?exchange=IDX&limit=5&minMarketCap=1000000'))
    const body = await response.json()

    expect(body.data.results[0]).toMatchObject({ symbol: 'S000.JK', marketCap: 100_000_000, pe: 12 })
    expect(body.data.count).toBe(2)
  })
  it('reports dividend sorting as bounded and does not claim a late high-yield row was snapshot-ranked', async () => {
    const requested: string[][] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      const symbols = (url.searchParams.get('symbols') ?? '').split(',')
      requested.push(symbols)
      return quoteResponse({ data: symbols.map(symbol => ({
        symbol,
        dividendYield: symbol === 'S500.JK' ? 99 : 1,
      })) })
    }))

    const response = await GET(new NextRequest('http://localhost/api/v1/screener?exchange=IDX&limit=5&sortBy=dividend'))
    const body = await response.json()

    expect(requested[0]).not.toContain('S500.JK')
    expect(body.data.quoteScope).toEqual({ mode: 'bounded', considered: 50, available: 843 })
    expect(body.data.notice).toBe('Dividend data unavailable in snapshot; results reflect live quotes on initial candidate pool')
  })

  it('documents minDividend filtering against only the bounded live-quoted subset', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const symbols = (new URL(String(input)).searchParams.get('symbols') ?? '').split(',')
      return quoteResponse({ data: symbols.map(symbol => ({ symbol, dividendYield: 5 })) })
    }))

    const response = await GET(new NextRequest('http://localhost/api/v1/screener?exchange=IDX&limit=5&minDividend=2'))
    const body = await response.json()

    expect(body.data.quoteScope).toEqual({ mode: 'snapshot-ranked', considered: 50, available: 843 })
    expect(body.data.notice).toBe('Dividend filtering is evaluated only against the bounded live-quoted subset')
  })
  it('does not claim global snapshot ranking when non-IDX candidates have no snapshot rows', async () => {
    vi.doMock('@/lib/config/universe', () => ({
      SCREENER_STOCKS: [{ symbol: 'AAPL', name: 'Apple', sector: 'Technology', exchange: 'NASDAQ' }],
    }))
    vi.resetModules()
    const { GET: mixedGET } = await import('./route')
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const symbols = (new URL(String(input)).searchParams.get('symbols') ?? '').split(',')
      return quoteResponse({ data: symbols.map(symbol => ({ symbol, marketCap: 1 })) })
    }))

    const response = await mixedGET(new NextRequest('http://localhost/api/v1/screener?limit=5&sortBy=marketCap'))
    const body = await response.json()

    expect(body.data.quoteScope).toEqual({ mode: 'bounded', considered: 50, available: 844 })
    expect(body.data.notice).toBe('Snapshot ranking is partial; results reflect live quotes on bounded candidate pool')
  })


})
  it('returns dated IDX snapshot rows when Yahoo times out', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.searchParams.get('symbols') === 'IDRUSD=X') {
        return quoteResponse({ data: [{ symbol: 'IDRUSD=X', regularMarketPrice: 0.0000625 }] })
      }
      throw new Error('The operation aborted due to timeout')
    }))

    const response = await GET(new NextRequest('http://localhost/api/v1/screener?exchange=IDX&limit=5'))
    const body = await response.json()

    expect(body.data.results[0]).toMatchObject({ symbol: 'S000.JK', currency: 'USD', price: 0.5, changePercent: 1.25, marketCap: 100_000_000 })
    expect(body.data.snapshot).toMatchObject({ capturedAt: '2026-10-24', fxAvailable: true })
    expect(body.error).toBe('The operation aborted due to timeout')
  })

  it('returns HTTP 200 with an explicit notice when quotes time out without a usable snapshot', async () => {
    vi.mocked(getScreenerSnapshot).mockResolvedValueOnce({ data: {} } as never)
    vi.mocked(getScreenerSnapshot).mockResolvedValueOnce({ data: {} } as never)
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('The operation aborted due to timeout')
    }))

    const response = await GET(new NextRequest('http://localhost/api/v1/screener?exchange=IDX&limit=5'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({ results: [], count: 0, notice: 'Screener quotes temporarily unavailable' })
    expect(body.error).toBe('The operation aborted due to timeout')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
