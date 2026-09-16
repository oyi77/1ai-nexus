// ─────────────────────────────────────────────────────────────
// Stockbit provider tests — pure parsers, zero network.
// Fixtures mirror the live 2026-09-16 session shapes byte-for-byte
// in structure (values trimmed). Session tests override
// STOCKBIT_SESSION_PATH to a tmp dir.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseBandarSummary,
  parseDistribution,
  normalizeCode,
} from './client'
import {
  resolveStockbitAccessToken,
  resetStockbitSession,
  hasSessionCredentials,
  redactJwt,
} from './session'

const BBRI_SUMMARY = {
  message: 'Successfully retrieved market detector data',
  data: {
    from: '2026-09-15',
    to: '2026-09-15',
    broker_summary: {
      symbol: 'BBRI',
      brokers_buy: [
        {
          blot: '97200',
          blotv: '2.41453e+07',
          bval: '3.2429985e+10',
          bvalv: '8.0563636e+10',
          netbs_broker_code: 'RX',
          netbs_buy_avg_price: '3336.6177268453903',
          netbs_date: '20260915',
          netbs_stock_code: 'BBRI',
          type: 'Asing',
          freq: '2208',
        },
      ],
      brokers_sell: [
        {
          blot: '50000',
          bval: '1.6e+10',
          netbs_broker_code: 'ZP',
          netbs_buy_avg_price: '3200.5',
          netbs_date: '20260915',
          netbs_stock_code: 'BBRI',
          type: 'Lokal',
          freq: '900',
        },
      ],
    },
    bandar_detector: {
      average: 3337.5884,
      broker_accdist: 'Dist',
      number_broker_buysell: 23,
      avg: { accdist: 'Big Dist', amount: -51172553000, percent: -32.199463, vol: -153321.94 },
      avg5: { accdist: 'Big Dist', amount: -55155585000, percent: -34.70572, vol: 0 },
      top1: { accdist: 'Big Dist', amount: -61783770000, percent: -38.876392, vol: 0 },
      top3: { accdist: 'Big Dist', amount: -57821050000, percent: -36.38292, vol: 0 },
      top5: { accdist: 'Big Dist', amount: -40541020000, percent: -25.509752, vol: 0 },
      top10: { accdist: 'Small Dist', amount: -18459202000, percent: -11.61514, vol: 0 },
    },
  },
}

const BBRI_DIST = {
  data: {
    start_date: '2026-09-14',
    end_date: '2026-09-14',
    date_info: '2026-09-14',
    by_value: {
      top_broker_buy: [
        {
          detail: { code: 'AK', type: 'Asing', amount: 246560964000 },
          distribute_to: [
            { code: 'AK', type: 'Asing', amount: 32087807000 },
            { code: 'XL', type: 'Asing', amount: 24971838000 },
          ],
        },
      ],
      top_broker_sell: [
        { detail: { code: 'ZP', type: 'Lokal', amount: 100 }, distribute_to: [] },
      ],
    },
    by_volume: {},
  },
}

describe('normalizeCode', () => {
  it("strips .JK and uppercases", () => {
    expect(normalizeCode('bbri.jk')).toBe('BBRI')
    expect(normalizeCode(' BBCA ')).toBe('BBCA')
  })
})

describe('parseBandarSummary', () => {
  it('parses the live BBRI shape incl string scientific values', () => {
    const out = parseBandarSummary('BBRI', BBRI_SUMMARY)!
    expect(out.code).toBe('BBRI')
    expect(out.tradeDate).toBe('2026-09-15')
    expect(out.buyCount).toBe(1)
    expect(out.sellCount).toBe(1)
    expect(out.buy[0]).toMatchObject({ code: 'RX', lot: 97200, foreign: true })
    expect(out.buy[0].value).toBeCloseTo(3.2429985e10)
    expect(out.buy[0].avgPrice).toBeCloseTo(3336.6177)
    expect(out.sell[0]).toMatchObject({ code: 'ZP', foreign: false })
    expect(out.accdist).toBe('Dist')
    expect(out.levels.avg).toMatchObject({ accdist: 'Big Dist', amount: -51172553000 })
    expect(out.levels.top10.accdist).toBe('Small Dist')
  })

  it('null on error envelope', () => {
    expect(parseBandarSummary('X', { message: 'x', error_type: 'INVALID_PARAMETER' })).toBeNull()
    expect(parseBandarSummary('X', null)).toBeNull()
  })
})

describe('parseDistribution', () => {
  it('parses top buyer + counterparties', () => {
    const out = parseDistribution('BBRI', BBRI_DIST)!
    expect(out.session).toBe('2026-09-14')
    expect(out.topBuyer?.code).toBe('AK')
    expect(out.topBuyer?.amount).toBe(246560964000)
    expect(out.topBuyer?.counterparties).toHaveLength(2)
    expect(out.topBuyer?.counterparties[0]).toMatchObject({ code: 'AK', amount: 32087807000 })
    expect(out.topSeller?.code).toBe('ZP')
  })

  it('null on error envelope', () => {
    expect(parseDistribution('X', { error_type: 'INVALID_PARAMETER' })).toBeNull()
  })
})

describe('redactJwt', () => {
  it('redacts JWT-shaped strings', () => {
    const tok =
      'eyJhbGciOiJSUzI1NiJ9.' + Buffer.from(JSON.stringify({ uid: 1 })).toString('base64url') + '.c2lnbmF0dXJl'
    expect(redactJwt(`token=${tok} end`)).toBe('token=JWT<redacted> end')
    expect(redactJwt('no tokens here')).toBe('no tokens here')
  })
})

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sb-sess-'))
  process.env.STOCKBIT_SESSION_PATH = join(dir, 'session.json')
  delete process.env.STOCKBIT_ACCESS_TOKEN
  delete process.env.STOCKBIT_REFRESH_TOKEN
  resetStockbitSession()
})

afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
})

const FRESH_JWT =
  'eyJhbGciOiJSUzI1NiJ9.' +
  Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url') +
  '.c2lnbmF0dXJl'
const RT_JWT = (tag: string) =>
  'eyJhbGciOiJSUzI1NiJ9.' +
  Buffer.from(JSON.stringify({ typ: 'refresh', tag })).toString('base64url') +
  '.c2lnbmF0dXJl'

function mockRefreshSequence(pairs: Array<{ accessToken: string; refreshToken: string }>) {
  const queue = [...pairs]
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>)?.authorization ?? ''
      if (!auth.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 })
      }
      const next = queue.shift() ?? queue[queue.length - 1]
      return new Response(
        JSON.stringify({ data: { data: { access: { token: next.accessToken }, refresh: { token: next.refreshToken } } } }),
        { status: 200 },
      )
    }),
  )
}

describe('resolveStockbitAccessToken', () => {
  it('rotates from env seed pair and persists (0600)', async () => {
    process.env.STOCKBIT_ACCESS_TOKEN = 'stale.at.here'
    process.env.STOCKBIT_REFRESH_TOKEN = RT_JWT('env')
    mockRefreshSequence([{ accessToken: FRESH_JWT, refreshToken: RT_JWT('1') }])
    const t = await resolveStockbitAccessToken()
    expect(t).toBe(FRESH_JWT)
    expect(hasSessionCredentials()).toBe(true)
    const persisted = JSON.parse(readFileSync(process.env.STOCKBIT_SESSION_PATH!, 'utf8'))
    expect(persisted.refreshToken).toBe(RT_JWT('1'))
    expect(persisted.accessToken).toBe(FRESH_JWT)
  })
  it('serves persisted valid token without network', async () => {
    writeFileSync(
      process.env.STOCKBIT_SESSION_PATH!,
      JSON.stringify({ accessToken: FRESH_JWT, accessTokenExp: Date.now() + 3600_000, refreshToken: RT_JWT('file') }),
    )
    if (!existsSync(process.env.STOCKBIT_SESSION_PATH!)) throw new Error('seed failed')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network should not be hit')
      }),
    )
    resetStockbitSession()
    expect(await resolveStockbitAccessToken()).toBe(FRESH_JWT)
  })

  it('propagates actionable error on dead RT', async () => {
    process.env.STOCKBIT_REFRESH_TOKEN = 'rt-dead'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 })),
    )
    await expect(resolveStockbitAccessToken()).rejects.toThrow('re-stage a fresh refresh token')
  })
})
