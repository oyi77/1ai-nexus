import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import yahooFinance from './quotes'
import { _clearCaches } from '../../fetch-with-cache'

function jsonResponse(symbol: string): Response {
  return {
    ok: true,
    json: async () => ({ chart: { result: [{ meta: { symbol, regularMarketPrice: 1 } }] } }),
  } as Response
}

beforeEach(() => _clearCaches())
afterEach(() => {
  _clearCaches()
  vi.unstubAllGlobals()
})

describe('Yahoo Finance quote concurrency', () => {
  it('bounds quote fan-out while preserving input order and isolating failures', async () => {
    const symbols = Array.from({ length: 30 }, (_, i) => `S${i}`)
    const pending = new Map<string, { resolve: (response: Response) => void; reject: (error: Error) => void }>()
    let active = 0
    let maxActive = 0
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const symbol = decodeURIComponent(String(input).split('/v8/finance/chart/')[1].split('?')[0])
      active++
      maxActive = Math.max(maxActive, active)
      return new Promise<Response>((resolve, reject) => {
        pending.set(symbol, {
          resolve: response => { active--; resolve(response) },
          reject: error => { active--; reject(error) },
        })
      })
    }))

    const resultPromise = yahooFinance.fetch<Record<string, unknown>[]>({ action: 'quote', symbols: symbols.join(',') })
    await vi.waitFor(() => expect(pending.size).toBe(12))

    for (let i = 0; i < symbols.length; i++) {
      const symbol = `S${i}`
      const attempts = i === 3 || i === 17 ? 2 : 1
      for (let attempt = 0; attempt < attempts; attempt++) {
        await vi.waitFor(() => expect(pending.has(symbol)).toBe(true))
        const request = pending.get(symbol)!
        pending.delete(symbol)
        if (attempts === 2) request.reject(new Error('upstream failed'))
        else request.resolve(jsonResponse(symbol))
      }
    }

    const result = await resultPromise
    expect(maxActive).toBe(12)
    expect(result.data.map(quote => quote.symbol)).toEqual(symbols.filter((_, i) => i !== 3 && i !== 17))
  })
})
