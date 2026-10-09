import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverAlphTokens, auditAlphToken } from '../alph'

const ALPH_VOLUME_ROW = {
  tokenAddress: 'EEpng77ZPn9FbgbT4xsRjwuxNCcMBYq3HTwEscyTpump',
  chain: 'sol',
  icon: 'https://static.alphstatic.com/dex/token-icon/36/368158a0.webp',
  tokenCode: 'HeeHaw',
  tokenFullName: 'Justice for HeeHaw',
  tokenCreateTime: 1788106080000,
  poolCreateTime: 1788106264000,
  openTime: 1788106264000,
  price: '0.0051981108046503',
  marketCap: '5088681.686990444',
  liquidity: 334370.24474573194,
  bc: '7413',
  sc: '7113',
  r: '55.2951',
  holders: 6228,
  ba: '1073044.4375060701',
  sa: '1154091.3618663263',
  hotTopic: 'sol_EEpng77ZPn9FbgbT4xsRjwuxNCcMBYq3HTwEscyTpump',
  hotTopicTitle: '$Heehaw CA Sparks Discussion',
  hotScore: '21.1163',
  platformId: 1,
  social: {
    twitter: 'https://x.com/justiceforhh?s=11',
    website: 'https://example.com/',
    telegram: '',
  },
  label: 'Animals',
  sentence: '$HeeHaw is a Solana meme coin',
  paragraph: '$HeeHaw is a Solana meme coin based on an incident',
}

const ALPH_GAINER_ROW = {
  tokenAddress: '4tSrhyh2WSTht6DrtiuWGD5BYDkyNMHFT5c7vxCdpump',
  chain: 'sol',
  icon: 'https://static.alphstatic.com/dex/token-icon/a4/a435ad76.webp',
  tokenCode: 'ATFS',
  tokenFullName: 'American Trust Fund System',
  tokenCreateTime: 1791470687000,
  price: '0.00015706183882412475081807871704',
  marketCap: '17259525.4606698214546292135048228690780220404112',
  r: '1469.6062',
  platformId: 1,
  label: 'Others',
  social: { twitter: '', website: 'https://atfs.info/', telegram: '' },
  holders: 2012,
  vol24h: '796004544.29803',
  netInflow24h: '250.393900712',
  openTime: 1791470687000,
  poolCreateTime: 1791470687000,
}

const ALPH_GRADUATED_ROW = {
  chain: 'sol',
  tokenAddress: '31G6Nkdza8LzVD2Y3mAxKFsmL5jF6NhtZMjFGt4ra9rA',
  icon: 'https://static.alphstatic.com/dex/token-icon/96x96/40/40ade.webp',
  code: 'SOCIAL',
  tokenCreateTime: 1791513253000,
  poolTime: 1791513405000,
  label: 'Meme',
  vol: '10831.15500419494',
  marketCap: '49041.4200525599984155346877139',
  r: '2.2664',
  platformId: '8',
}

const ALPH_SEO_ROW = {
  chain: 'sol',
  tokenAddress: 'EEpng77ZPn9FbgbT4xsRjwuxNCcMBYq3HTwEscyTpump',
  code: 'HeeHaw',
  fullName: 'Justice for HeeHaw',
  price: 0.00004507338514084937,
  priceUsdt: 0.004970237638381382,
  chg24h: 45.5133,
  marketCap: 4865605.640379016,
  poolLiquidity: 2966.7737619885065,
  vol24h: 23425.618291779036,
  top10: 0.2182051594,
  holdersNum: 6557,
  aiNarrativeSentence: '$HeeHaw is a Solana meme coin',
  aiNarrativeParagraph: '$HeeHaw is a Solana meme coin based on an incident',
}

const SEO_OK = { status: 200, body: { code: '200', msg: 'suc', data: ALPH_SEO_ROW } }
const STATS_EMPTY = { status: 200, body: { code: '200', msg: 'suc' } } // no data -> SEO fallback
const HOLDERS_EMPTY = { status: 200, body: { code: '200', msg: 'suc', data: [] } }

function mockFetchSequence(responses: Array<{ status: number; body: unknown }>) {
  const queue = [...responses]
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      // Audit fetches seo+stats+holders in parallel — route by URL so queued
      // discovery responses aren't consumed by audit calls and vice versa.
      if (input.includes('/holders/stats')) {
        const q = queue.find((r) =>
          JSON.stringify(r.body).includes('developerPercent') || JSON.stringify(r.body).includes('top10Percent'),
        )
        const next = q ?? STATS_EMPTY
        queue.splice(queue.indexOf(next), 1)
        return new Response(JSON.stringify(next.body), { status: next.status })
      }
      if (input.includes('/coin/detail/holders')) {
        return new Response(JSON.stringify(HOLDERS_EMPTY.body), { status: 200 })
      }
      const next = queue.shift() ?? { status: 200, body: { code: '200', msg: 'suc', data: { list: [] } } }
      // Keep the signal in the mock so the timeout test exercises the adapter's
      // AbortSignal wiring rather than merely rejecting an arbitrary promise.
      if (init?.signal?.aborted) throw new Error('request aborted')
      expect(input).toContain('b.alph.ai')
      return new Response(JSON.stringify(next.body), {
        status: next.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('discoverAlphTokens', () => {
  it('preserves Alph identity and discovery provenance', async () => {
    mockFetchSequence([
      { status: 200, body: { code: '200', msg: 'suc', data: { list: [ALPH_VOLUME_ROW] } } },
      { status: 200, body: { code: '200', msg: 'suc', data: { list: [ALPH_GAINER_ROW] } } },
      { status: 200, body: { code: '200', msg: 'suc', data: [ALPH_GRADUATED_ROW] } },
    ])

    const tokens = await discoverAlphTokens(10)
    expect(tokens).toHaveLength(3)
    // Measured live 2026-10-09: alph emits short chain labels, normalized here.
    expect(tokens[0].chain).toBe('solana')
    expect(tokens[0].platform).toBe('alph')
    expect(tokens[0].symbol).toBe('HeeHaw')
    // `r` is a ratio (r=55.2951 renders "+55.5x" on alph.ai SSR).
    expect(tokens[0].change24h).toBeCloseTo(55.2951, 4)
    expect(tokens[0].provenance).toEqual({
      sourceType: 'public-api',
      provider: 'alph',
      experimental: true,
      note: 'Alph.ai smart-web-gateway discovery feed (volume/gainer/graduated), not a security audit',
    })
    expect(tokens[0].riskKnown).toBe(false)
  })

  it('maps graduated rows without price/holders to zeroed placeholders', async () => {
    mockFetchSequence([
      { status: 200, body: { code: '200', msg: 'suc', data: { list: [] } } },
      { status: 200, body: { code: '200', msg: 'suc', data: { list: [] } } },
      { status: 200, body: { code: '200', msg: 'suc', data: [ALPH_GRADUATED_ROW] } },
    ])

    const tokens = await discoverAlphTokens(10)
    expect(tokens).toHaveLength(1)
    expect(tokens[0].symbol).toBe('SOCIAL')
    expect(tokens[0].price).toBe(0)
    expect(tokens[0].holders).toBe(0)
    expect(tokens[0].volume24h).toBeCloseTo(10831.155, 2)
  })

  it('deduplicates tokens appearing in multiple feeds', async () => {
    mockFetchSequence([
      { status: 200, body: { code: '200', msg: 'suc', data: { list: [ALPH_VOLUME_ROW] } } },
      {
        status: 200,
        body: { code: '200', msg: 'suc', data: { list: [{ ...ALPH_VOLUME_ROW, r: '54.0' }] } },
      },
      { status: 200, body: { code: '200', msg: 'suc', data: [] } },
    ])

    const tokens = await discoverAlphTokens(10)
    expect(tokens).toHaveLength(1)
  })
  it('throws the upstream status and body snippet for non-2xx responses', async () => {
    // Fixed 503 on every attempt — the adapter retries 5xx, so a queue that
    // replenishes with 200 would mask the failure.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'alph maintenance body snippet' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    )

    await expect(discoverAlphTokens(1)).rejects.toThrow('Alph 503:')
  })

  it('reverse-maps canonical chain labels to upstream short ids', async () => {
    const seen: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        seen.push(url)
        return new Response(JSON.stringify({ code: '200', msg: 'suc', data: ALPH_SEO_ROW }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    const audit = await auditAlphToken('solana', ALPH_SEO_ROW.tokenAddress)
    expect(audit).not.toBeNull()
    // Probed live 2026-10-09: chain=sol returns data; chain=solana returns
    // {"code":"200"} with no data field.
    expect(seen[0]).toContain('chain=sol&')
    expect(seen[0]).not.toContain('chain=solana')
    // Output keeps the canonical label the route passed in.
    expect(audit!.chain).toBe('solana')
  })
  it('rejects when the upstream request is aborted by the timeout signal', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: string, init?: RequestInit) => {
          // Faithful fetch semantics: already-aborted signal rejects immediately.
          if (init?.signal?.aborted) return Promise.reject(new Error('request aborted'))
          return new Promise<never>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('request aborted')))
          })
        },
      ),
    )
    const pending = discoverAlphTokens(1)
    // Attach the rejection handler BEFORE advancing timers: the matcher
    // subscribes on call, so the abort rejection (fired mid-advance) always
    // has a handler and never surfaces as an unhandled rejection.
    const assertion = expect(pending).rejects.toThrow('request aborted')
    await vi.advanceTimersByTimeAsync(12_000)
    await assertion
  })
})

describe('auditAlphToken', () => {
  const STATS_CLEAN = {
    status: 200,
    body: {
      code: '200',
      msg: 'suc',
      data: {
        totalHolders: '6557',
        top10Percent: 0.2182,
        developerPercent: 0,
        sniperPercent: 0,
        insiderTradingPercent: 0,
        bundleWalletPercent: 0.003,
      },
    },
  }

  it('maps the SEO gateway detail to a risk audit', async () => {
    mockFetchSequence([SEO_OK, STATS_CLEAN])

    const audit = await auditAlphToken('solana', ALPH_SEO_ROW.tokenAddress)
    expect(audit).not.toBeNull()
    expect(audit!.platform).toBe('alph')
    expect(audit!.chain).toBe('solana')
    expect(audit!.symbol).toBe('HeeHaw')
    // stats top10 wins over SEO top10
    expect(audit!.top10HolderPercent).toBeCloseTo(0.2182, 4)
    expect(audit!.distribution).toEqual({
      devPercent: 0,
      sniperPercent: 0,
      bundlerPercent: 0.003,
      insiderPercent: 0,
    })
    expect(audit!.lpLockedPercent).toBe(-1)
    expect(audit!.riskLevel).toBe(1)
    expect(audit!.riskLabel).toBe('low')
  })

  it('flags high concentration as high risk', async () => {
    mockFetchSequence([
      {
        status: 200,
        body: {
          code: '200',
          msg: 'suc',
          data: { ...ALPH_SEO_ROW, top10: 0.85, holdersNum: 12 },
        },
      },
    ])

    const audit = await auditAlphToken('solana', ALPH_SEO_ROW.tokenAddress)
    expect(audit!.riskLevel).toBe(3)
    expect(audit!.riskLabel).toBe('high')
  })

  it('flags dev/sniper/insider concentration as high risk', async () => {
    mockFetchSequence([
      SEO_OK,
      {
        status: 200,
        body: {
          code: '200',
          msg: 'suc',
          data: {
            totalHolders: '900',
            top10Percent: 0.3,
            developerPercent: 0.05,
            sniperPercent: 0,
            insiderTradingPercent: 0,
            bundleWalletPercent: 0.01,
          },
        },
      },
    ])

    const audit = await auditAlphToken('solana', ALPH_SEO_ROW.tokenAddress)
    expect(audit!.riskLevel).toBe(3)
    expect(audit!.distribution!.devPercent).toBeCloseTo(0.05, 4)
  })

  it('returns null for empty detail payloads', async () => {
    mockFetchSequence([{ status: 200, body: { code: '200', msg: 'suc' } }])

    await expect(auditAlphToken('solana', '0xdead')).resolves.toBeNull()
  })
})
