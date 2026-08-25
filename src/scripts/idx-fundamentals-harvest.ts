// ─────────────────────────────────────────────────────────────
// IDX Fundamentals Harvester — nightly PER/PBV/market-cap batch
// for the whole universe via Yahoo quoteSummary.
//
// Yahoo throttles aggressive server IPs (429s observed), so this
// runs SLOW and POLITE: concurrency 2, ~400ms spacing, resumable
// progress file, partial results always saved. Cron at a quiet
// hour:
//   20 18 * * 1-5 cd /home/openclaw/projects/1ai-tracker && npm run harvest:idx-fundamentals >> /tmp/idx-fundamentals.log 2>&1
// Output: data/idx/fundamentals.json { capturedAt, done:[codes], data:{CODE:{...}} }
// ─────────────────────────────────────────────────────────────

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import { notifyAlert } from '@/lib/config/alerting'

const OUT = join(process.cwd(), 'data', 'idx', 'fundamentals.json')
const PROGRESS = join(process.cwd(), 'data', 'idx', 'fundamentals.progress.json')
const UNIVERSE = join(process.cwd(), 'data', 'idx', 'universe.json')
const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com']
const CONCURRENCY = 2
const GAP_MS = 400

interface FundRow {
  per?: number | null
  pbv?: number | null
  roe?: number | null
  der?: number | null
  eps?: number | null
  marketCap?: number | null
  dividendYield?: number | null
}

type Store = { capturedAt: string; done: string[]; data: Record<string, FundRow> }

// Yahoo raw-number envelope: numbers arrive as { raw: number, fmt: string }.
const RawNum = z.object({ raw: z.number().nullable() }).loose()
const SummaryDetail = z.object({
  trailingPE: RawNum.optional(),
  priceToBook: RawNum.optional(),
  dividendYield: RawNum.optional(),
  marketCap: RawNum.optional(),
}).loose()
const KeyStats = z.object({
  trailingEps: RawNum.optional(),
  marketCap: RawNum.optional(),
}).loose()
const FinancialData = z.object({
  returnOnEquity: RawNum.optional(),
  debtToEquity: RawNum.optional(),
}).loose()
const QuoteSummaryEnvelope = z.object({
  quoteSummary: z.object({
    result: z.array(z.object({
      summaryDetail: SummaryDetail.optional(),
      defaultKeyStatistics: KeyStats.optional(),
      financialData: FinancialData.optional(),
    })).min(1),
  }).optional(),
})

function loadStore(): Store {
  try {
    return JSON.parse(readFileSync(OUT, 'utf8')) as Store
  } catch {
    return { capturedAt: new Date().toISOString(), done: [], data: {} }
  }
}

function loadProgress(): string[] {
  try {
    return JSON.parse(readFileSync(PROGRESS, 'utf8')) as string[]
  } catch {
    return []
  }
}

function save(store: Store): void {
  mkdirSync(join(process.cwd(), 'data', 'idx'), { recursive: true })
  const tmp = `${OUT}.tmp`
  writeFileSync(tmp, JSON.stringify(store))
  renameSync(tmp, OUT)
}

const pickRaw = (obj: { raw?: number | null } | undefined): number | null =>
  typeof obj?.raw === 'number' ? obj.raw : null

async function fetchFundamentals(code: string): Promise<FundRow> {
  let lastErr: unknown
  for (const host of HOSTS) {
    try {
      const url = `${host}/v10/finance/quoteSummary/${code}?modules=defaultKeyStatistics,summaryDetail,financialData`
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
        headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36' },
      })
      if (res.status === 429) throw new Error('429 throttled')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const parsed = QuoteSummaryEnvelope.parse(await res.json())
      const r = parsed.quoteSummary?.result?.[0] ?? {}
      return {
        per: pickRaw(r.summaryDetail?.trailingPE),
        pbv: pickRaw(r.summaryDetail?.priceToBook),
        dividendYield: pickRaw(r.summaryDetail?.dividendYield),
        roe: pickRaw(r.financialData?.returnOnEquity),
        der: pickRaw(r.financialData?.debtToEquity),
        eps: pickRaw(r.defaultKeyStatistics?.trailingEps),
        marketCap: pickRaw(r.summaryDetail?.marketCap ?? r.defaultKeyStatistics?.marketCap),
      }
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

async function main() {
  const universe = JSON.parse(readFileSync(UNIVERSE, 'utf8')) as { stocks: Array<{ symbol: string }> }
  const codes = universe.stocks.map((s) => s.symbol.replace('.JK', ''))
  const store = loadStore()
  const skip = new Set([...store.done, ...loadProgress()])
  const queue = codes.filter((c) => !skip.has(c))

  console.log(`[idx-fund] total ${codes.length} · already done ${skip.size} · to fetch ${queue.length}`)

  let failures = 0
  let i = 0
  async function worker(): Promise<void> {
    while (i < queue.length) {
      const code = queue[i++]
      try {
        store.data[code] = await fetchFundamentals(code)
      } catch (e) {
        failures++
        // Throttle-heavy runs: bail early so the next cron pass resumes.
        if (String(e).includes('429') && failures > 25) {
          console.log(`[idx-fund] repeated 429s — stopping early at ${code}`)
          break
        }
      }
      store.done.push(code)
      if (store.done.length % 50 === 0) {
        save(store)
        writeFileSync(PROGRESS, JSON.stringify(queue.slice(i)))
      }
      await new Promise((r) => setTimeout(r, GAP_MS))
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

  store.capturedAt = new Date().toISOString()
  save(store)
  writeFileSync(PROGRESS, JSON.stringify([]))

  const covered = Object.keys(store.data).length
  console.log(`[idx-fund] coverage ${covered}/${codes.length} · session failures ${failures} → ${OUT}`)
  if (covered < codes.length * 0.9 && covered < 100) {
    await notifyAlert('IDX fundamentals harvest degraded', `coverage ${covered}/${codes.length}`)
  }
}

main().catch(async (err) => {
  const msg = err instanceof Error ? err.message : err
  console.error('[idx-fund] harvest failed:', msg)
  await notifyAlert('IDX fundamentals harvest FAILED', String(msg))
  process.exit(1)
})
