// ─────────────────────────────────────────────────────────────
// CrossEx harvester — captures Gate CrossEx funding-rate arbitrage
// snapshots into data/crossex/snapshot.json.
//
// Why a browser: www.gate.com/apiw/v2/crossex/* sits behind Akamai,
// which 403s server-side fetches from this host even with browser
// headers. A real Chromium context passes — but only after the
// HTML page has issued Akamai sensor cookies (_abck/bm_sv).
//
// Run: npm run harvest:crossex        (one shot)
// Schedule: user crontab, e.g.
//   */20 * * * * cd /home/openclaw/projects/1ai-tracker && npm run harvest:crossex >> /tmp/crossex-harvest.log 2>&1
// ─────────────────────────────────────────────────────────────

import { chromium } from 'playwright'
import type { Page } from 'playwright'
import { mkdirSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'

const OUT_FILE = join(process.cwd(), 'data', 'crossex', 'snapshot.json')
const API = 'https://www.gate.com/apiw/v2/crossex/arbitrage'
const PAGE_SIZE = 100
const MAX_PAGES = 12 // hard cap: 786 coins today → 8 pages

const ExchangeValue = z.object({ exchange: z.string(), value: z.string() })
const ArbRow = z.object({ base: z.string(), maxApy: z.string(), values: z.array(ExchangeValue) })

const ViewPage = z.object({ list: z.array(ArbRow), total: z.number() })
const StringList = z.array(z.string())

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

/** Akamai issues sensor cookies (_abck/bm_sv) on the HTML page; API calls without them 403. */
async function warmup(page: Page): Promise<void> {
  await page.goto('https://www.gate.com/crossex/rate', { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await delay(4000)
}

async function gotoJson<T extends z.ZodTypeAny>(page: Page, url: string, schema: T): Promise<z.infer<T>> {
  const Envelope = z.object({ code: z.number(), message: z.string(), data: z.unknown() })
  let lastErr: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      if (!res || !res.ok()) throw new Error(`HTTP ${res?.status() ?? 'null'}`)
      const text = await page.evaluate(() => document.body.innerText)
      const parsed = Envelope.parse(JSON.parse(text))
      if (parsed.code !== 0) throw new Error(`api code ${parsed.code}: ${parsed.message}`)
      return schema.parse(parsed.data) as z.infer<T>
    } catch (err) {
      lastErr = err
      if (attempt < 3) await delay(2000 * attempt)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

async function main() {
  // Headed mode: Akamai fingerprints headless Chrome and 403s the API even
  // with valid sensor cookies. The box runs a desktop session (DISPLAY set).
  const browser = await chromium.launch({ channel: 'chrome', headless: false })
  try {
    const context = await browser.newContext({ locale: 'en-US' })
    const page = await context.newPage()

    await warmup(page)

    const first = await gotoJson(page, `${API}/view?benchmarkExchange=NONE&interval=live&page=1&pageSize=${PAGE_SIZE}&sort=desc&type=fundingRate&sub_website_id=0`, ViewPage)
    const rows = [...first.list]
    const totalPages = Math.min(Math.ceil(first.total / PAGE_SIZE), MAX_PAGES)

    for (let p = 2; p <= totalPages; p++) {
      const j = await gotoJson(page, `${API}/view?benchmarkExchange=NONE&interval=live&page=${p}&pageSize=${PAGE_SIZE}&sort=desc&type=fundingRate&sub_website_id=0`, ViewPage)
      rows.push(...j.list)
    }

    let exchanges: string[] = []
    try {
      exchanges = await gotoJson(page, `${API}/exchange?sub_website_id=0`, StringList)
    } catch { /* optional dataset */ }

    const snapshot = {
      capturedAt: new Date().toISOString(),
      source: 'gate-crossex',
      type: 'fundingRate',
      interval: 'live',
      total: first.total,
      captured: rows.length,
      exchanges,
      rows,
    }

    mkdirSync(join(process.cwd(), 'data', 'crossex'), { recursive: true })
    const tmp = `${OUT_FILE}.tmp`
    writeFileSync(tmp, JSON.stringify(snapshot))
    renameSync(tmp, OUT_FILE)

    console.log(`[crossex] captured ${rows.length}/${first.total} rows (${totalPages} pages) → ${OUT_FILE}`)
  } finally {
    await browser.close()
  }
}

main().catch(err => {
  console.error('[crossex] harvest failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
