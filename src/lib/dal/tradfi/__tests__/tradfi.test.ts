// ─────────────────────────────────────────────────────────────
// TradFi DAL — Unit tests
// §2.4 — Tests for SEC EDGAR and FRED fetchers
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'

// ─── SEC EDGAR tests ───────────────────────────────────────

describe('SEC EDGAR', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(async () => {
    originalFetch = globalThis.fetch
    // Reset module cache to get fresh imports
    vi.resetModules()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  describe('searchCompany', () => {
    it('returns parsed company results from search API', async () => {
      const mockResponse = {
        hits: {
          hits: [
            {
              _source: {
                entity_name: 'Apple Inc.',
                ciks: ['0000320193'],
                tickers: ['AAPL'],
                exchanges: ['Nasdaq'],
              },
            },
            {
              _source: {
                entity_name: 'Apple Hospitality REIT Inc',
                ciks: ['0001418121'],
                tickers: ['APLE'],
                exchanges: ['NYSE'],
              },
            },
          ],
        },
      }

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      })

      const { searchCompany } = await import('@/lib/dal/tradfi/sec-edgar')
      const results = await searchCompany('apple')

      expect(results).toHaveLength(2)
      expect(results[0]).toEqual({
        cik: '0000320193',
        name: 'Apple Inc.',
        ticker: 'AAPL',
        exchange: 'Nasdaq',
      })
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('apple'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': expect.stringContaining('1ai-tracker'),
          }),
        }),
      )
    })

    it('returns empty array for no results', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ hits: { hits: [] } }),
      })

      const { searchCompany } = await import('@/lib/dal/tradfi/sec-edgar')
      const results = await searchCompany('xyznonexistentcorp')
      expect(results).toEqual([])
    })

    it('throws on non-ok response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      })

      const { searchCompany } = await import('@/lib/dal/tradfi/sec-edgar')
      await expect(searchCompany('test')).rejects.toThrow('SEC search failed: 503')
    })
  })

  describe('getCompanyFacts', () => {
    it('fetches and returns company XBRL facts', async () => {
      const mockFacts = {
        cik: '0000320193',
        entityName: 'Apple Inc.',
        facts: {
          'us-gaap': {
            Revenue: [
              { end: '2024-09-28', val: 391035000000, form: '10-K', filed: '2024-11-01' },
            ],
          },
        },
      }

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockFacts),
      })

      const { getCompanyFacts } = await import('@/lib/dal/tradfi/sec-edgar')
      const facts = await getCompanyFacts('0000320193')

      expect(facts.cik).toBe('0000320193')
      expect(facts.entityName).toBe('Apple Inc.')
      expect(facts.facts['us-gaap']).toBeDefined()
    })

    it('normalizes CIK with zero-padding', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ cik: '320193', entityName: 'Test', facts: {} }),
      })

      const { getCompanyFacts } = await import('@/lib/dal/tradfi/sec-edgar')
      await getCompanyFacts('320193')

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('CIK0000320193.json'),
        expect.anything(),
      )
    })

    it('throws on non-ok response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      })

      const { getCompanyFacts } = await import('@/lib/dal/tradfi/sec-edgar')
      await expect(getCompanyFacts('9999999999')).rejects.toThrow('SEC facts failed')
    })
  })

  describe('getRecentFilings', () => {
    it('returns parsed recent filings', async () => {
      const mockSubmissions = {
        cik: '0000320193',
        name: 'Apple Inc.',
        filings: {
          recent: {
            accessionNumber: ['0000320193-24-000123', '0000320193-24-000124'],
            filingDate: ['2024-11-01', '2024-08-02'],
            reportDate: ['2024-09-28', '2024-06-29'],
            form: ['10-K', '10-Q'],
            primaryDocument: ['aapl-20240928.htm', 'aapl-20240629.htm'],
            primaryDocDescription: ['Annual report', 'Quarterly report'],
          },
        },
      }

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSubmissions),
      })

      const { getRecentFilings } = await import('@/lib/dal/tradfi/sec-edgar')
      const filings = await getRecentFilings('0000320193')

      expect(filings).toHaveLength(2)
      expect(filings[0]).toEqual({
        accessionNumber: '0000320193-24-000123',
        filingDate: '2024-11-01',
        reportDate: '2024-09-28',
        form: '10-K',
        primaryDocument: 'aapl-20240928.htm',
        description: 'Annual report',
      })
    })

    it('returns empty array when no filings exist', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ cik: '0000000000', name: 'Empty Corp' }),
      })

      const { getRecentFilings } = await import('@/lib/dal/tradfi/sec-edgar')
      const filings = await getRecentFilings('0000000000')
      expect(filings).toEqual([])
    })
  })

  describe('rate limiting', () => {
    it('includes User-Agent header per SEC rules', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ hits: { hits: [] } }),
      })

      const { searchCompany } = await import('@/lib/dal/tradfi/sec-edgar')
      await searchCompany('test')

      const callArgs = (globalThis.fetch as Mock).mock.calls[0]
      const headers = callArgs[1]?.headers as Record<string, string>
      expect(headers['User-Agent']).toContain('1ai-tracker')
      expect(headers['Accept']).toBe('application/json')
    })
  })
})

// ─── FRED DAL wrapper tests ────────────────────────────────

describe('FRED DAL wrapper', () => {
  describe('getFredSeriesData', () => {
    it('returns data without requiring FRED_API_KEY', async () => {
      delete process.env.FRED_API_KEY

      const { getFredSeriesData } = await import('@/lib/dal/tradfi/fred')
      const result = await getFredSeriesData('FEDFUNDS')

      expect(result).toHaveProperty('id', 'FEDFUNDS')
      expect(result).toHaveProperty('title')
      expect(result).toHaveProperty('observations')
      expect(result.observations.length).toBeGreaterThan(0)
    })
  })

  describe('getFredLatestValue', () => {
    it('returns a value without requiring FRED_API_KEY', async () => {
      delete process.env.FRED_API_KEY

      const { getFredLatestValue } = await import('@/lib/dal/tradfi/fred')
      const result = await getFredLatestValue('FEDFUNDS')

      expect(result).not.toBeNull()
      expect(result).toHaveProperty('date')
      expect(result).toHaveProperty('value')
    })
  })

  describe('getFredSeriesMeta', () => {
    it('returns series metadata without making API calls', async () => {
      const { getFredSeriesMeta } = await import('@/lib/dal/tradfi/fred')
      const meta = getFredSeriesMeta()

      expect(meta).toHaveProperty('FEDFUNDS')
      expect(meta).toHaveProperty('GDP')
      expect(meta).toHaveProperty('CPIAUCSL')
      expect(meta).toHaveProperty('UNRATE')
      expect(meta).toHaveProperty('DGS10')
      expect(meta.FEDFUNDS).toEqual({
        title: expect.any(String),
        unit: '%',
        category: 'rates',
      })
    })
  })
})

// ─── DAL Registry integration ──────────────────────────────

describe('TradFi DAL registration', () => {
  it('registers SEC EDGAR and FRED sources', async () => {
    const { getDalRegistry } = await import('@/lib/dal/registry')
    await import('@/lib/dal/tradfi')

    const registry = getDalRegistry()
    const secSource = registry.getStatus('sec-edgar')
    const fredSource = registry.getStatus('fred')

    expect(secSource).toBeDefined()
    expect(secSource?.source.domain).toBe('tradfi-filings')
    expect(secSource?.source.tier).toBe(0)

    expect(fredSource).toBeDefined()
    expect(fredSource?.source.domain).toBe('tradfi-macro')
    expect(fredSource?.source.tier).toBe(0)
  })
})
