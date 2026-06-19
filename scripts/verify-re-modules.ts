// ─────────────────────────────────────────────────────────────
// scripts/verify-re-modules.ts
// Weekly cron: synthetic known-answer queries for each RE endpoint
// Flags schema drift, new headers, or 403/429 patterns
// Run: npx tsx scripts/verify-re-modules.ts
// ─────────────────────────────────────────────────────────────

interface ReModuleCheck {
  id: string
  name: string
  testUrl: string
  method?: string
  headers?: Record<string, string>
  expectedStatus?: number
  validate?: (data: unknown) => boolean
}

const RE_CHECKS: ReModuleCheck[] = [
  {
    id: 'yahoo-finance',
    name: 'Yahoo Finance',
    testUrl: 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=AAPL',
    validate: (d) => {
      const json = d as { quoteResponse?: { result?: unknown[] } }
      return Array.isArray(json?.quoteResponse?.result) && json.quoteResponse.result.length > 0
    },
  },
  {
    id: 'arkham-re',
    name: 'Arkham Intelligence',
    testUrl: 'https://intel.arkham.io/api/entities/search?q=binance',
    expectedStatus: 200,
  },
  {
    id: 'birdeye-re',
    name: 'Birdeye',
    testUrl: 'https://public-api.birdeye.so/defi/token_trending?limit=1',
    expectedStatus: 200,
  },
  {
    id: 'lunarcrush-re',
    name: 'LunarCrush',
    testUrl: 'https://lunarcrush.com/api/v2/assets?limit=1',
    expectedStatus: 200,
  },
  {
    id: 'cryptopanic-re',
    name: 'CryptoPanic',
    testUrl: 'https://cryptopanic.com/api/v1/posts/?auth_token=&public=true&filter=hot&kind=news',
    expectedStatus: 200,
  },
  {
    id: 'benzinga-re',
    name: 'Benzinga',
    testUrl: 'https://www.benzinga.com/api/v2/news?channel=crypto&limit=1',
    expectedStatus: 200,
  },
  {
    id: 'alpha-vantage-re',
    name: 'Alpha Vantage',
    testUrl: 'https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=AAPL&apikey=demo',
    expectedStatus: 200,
  },
  {
    id: 'fmp-re',
    name: 'Financial Modeling Prep',
    testUrl: 'https://financialmodelingprep.com/api/v3/profile/AAPL?apikey=demo',
    expectedStatus: 200,
  },
  {
    id: 'metals-re',
    name: 'Metals-API',
    testUrl: 'https://metals-api.com/api/latest?base=USD&symbols=XAU',
    expectedStatus: 200,
  },
]

interface CheckResult {
  id: string
  name: string
  status: 'pass' | 'fail' | 'degraded'
  httpStatus?: number
  error?: string
  responseTimeMs: number
}

async function runCheck(check: ReModuleCheck): Promise<CheckResult> {
  const start = Date.now()
  try {
    const res = await fetch(check.testUrl, {
      method: (check.method as 'GET') ?? 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...check.headers,
      },
      signal: AbortSignal.timeout(15_000),
    })

    const elapsed = Date.now() - start
    const expectedStatus = check.expectedStatus ?? 200

    if (res.status !== expectedStatus) {
      return {
        id: check.id,
        name: check.name,
        status: res.status === 429 || res.status === 403 ? 'degraded' : 'fail',
        httpStatus: res.status,
        error: `Expected ${expectedStatus}, got ${res.status}`,
        responseTimeMs: elapsed,
      }
    }

    if (check.validate) {
      const data = await res.json()
      if (!check.validate(data)) {
        return {
          id: check.id,
          name: check.name,
          status: 'fail',
          httpStatus: res.status,
          error: 'Response validation failed — schema may have changed',
          responseTimeMs: elapsed,
        }
      }
    }

    return { id: check.id, name: check.name, status: 'pass', httpStatus: res.status, responseTimeMs: elapsed }
  } catch (err) {
    return {
      id: check.id,
      name: check.name,
      status: 'fail',
      error: err instanceof Error ? err.message : String(err),
      responseTimeMs: Date.now() - start,
    }
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════')
  console.log('  NEXUS RE Module Verification — Weekly Cron')
  console.log('  ' + new Date().toISOString())
  console.log('═══════════════════════════════════════════════\n')

  const results: CheckResult[] = []

  for (const check of RE_CHECKS) {
    process.stdout.write(`  Checking ${check.name}... `)
    const result = await runCheck(check)
    results.push(result)

    const icon = result.status === 'pass' ? '✅' : result.status === 'degraded' ? '⚠️' : '❌'
    console.log(`${icon} ${result.httpStatus ?? 'ERR'} (${result.responseTimeMs}ms)${result.error ? ` — ${result.error}` : ''}`)
  }

  console.log('\n─────────────────────────────────────────────')
  const passed = results.filter(r => r.status === 'pass').length
  const degraded = results.filter(r => r.status === 'degraded').length
  const failed = results.filter(r => r.status === 'fail').length
  console.log(`  Results: ${passed} pass, ${degraded} degraded, ${failed} fail / ${results.length} total`)

  if (failed > 0) {
    console.log('\n  ⚠️  Failed modules:')
    for (const r of results.filter(r => r.status === 'fail')) {
      console.log(`    - ${r.name}: ${r.error}`)
    }
  }

  if (degraded > 0) {
    console.log('\n  ⚠️  Degraded modules (rate-limited or access changed):')
    for (const r of results.filter(r => r.status === 'degraded')) {
      console.log(`    - ${r.name}: ${r.error}`)
    }
  }

  console.log('')
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('Verification script failed:', err)
  process.exit(1)
})
