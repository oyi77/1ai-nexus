// ─────────────────────────────────────────────────────────────
// IDX Saham Harvester — captures the daily IDX trading summary
// (full universe OHLCV + FOREIGN BUY/SELL volumes) plus the
// market-wide broker board, into data/idx/.
//
// Why a browser: www.idx.co.id sits behind Cloudflare; plain
// server fetches 403 while a real Chromium context passes after
// the HTML page issues clearance cookies (verified via spike).
//
// Outputs:
//   data/idx/saham-latest.json    latest session, trimmed fields
//   data/idx/foreign-history.json rolling 90-session foreign flows
//   data/idx/brokers-latest.json  market broker board (88 firms)
//
// Run: npm run harvest:idx-saham     (one shot)
// Cron (17:40 WIB weekdays = 10:40 UTC):
//   40 10 * * 1-5 cd /home/openclaw/projects/1ai-tracker && xvfb-run -a npm run harvest:idx-saham >> /tmp/idx-saham-harvest.log 2>&1
// ─────────────────────────────────────────────────────────────

import { chromium } from 'playwright'
import type { Page } from 'playwright'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { notifyAlert } from '@/lib/config/alerting'

const OUT_DIR = join(process.cwd(), 'data', 'idx')
const WARMUP_URL = 'https://www.idx.co.id/listed-companies/company-list'
const PAGE_SIZE = 1000
const HISTORY_SESSIONS = 90

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

/** Cloudflare clearance cookies are issued by the HTML page; bare API hits 403. */
async function warmup(page: Page): Promise<void> {
  await page.goto(WARMUP_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await delay(5000)
}

async function gotoJson(page: Page, url: string): Promise<Record<string, unknown>> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      if (!res || !res.ok()) throw new Error(`HTTP ${res?.status() ?? 'null'}`)
      return JSON.parse(await page.evaluate(() => document.body.innerText)) as Record<string, unknown>
    } catch (err) {
      lastErr = err
      if (attempt < 3) await delay(2000 * attempt)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number.parseFloat(String(v ?? '')) || 0)

interface StockRow {
  code: string
  name: string
  prev: number
  open: number
  high: number
  low: number
  close: number
  change: number
  volume: number
  value: number
  freq: number
  foreignBuy: number
  foreignSell: number
  listedShares: number
  tradeableShares: number
}

function toRow(d: Record<string, unknown>): StockRow {
  return {
    code: String(d.StockCode ?? ''),
    name: String(d.StockName ?? ''),
    prev: num(d.Previous),
    open: num(d.OpenPrice),
    high: num(d.High),
    low: num(d.Low),
    close: num(d.Close),
    change: num(d.Change),
    volume: num(d.Volume),
    value: num(d.Value),
    freq: num(d.Frequency),
    foreignBuy: num(d.ForeignBuy),
    foreignSell: num(d.ForeignSell),
    listedShares: num(d.ListedShares),
    tradeableShares: num(d.TradebleShares),
  }
}

async function fetchAllRows(page: Page, urlBase: string): Promise<{ rows: Array<Record<string, unknown>>; date: string | null }> {
  const rows: Array<Record<string, unknown>> = []
  let date: string | null = null
  for (let start = 0; ; start += PAGE_SIZE) {
    const env = await gotoJson(page, `${urlBase}${urlBase.includes('?') ? '&' : '?'}start=${start}&length=${PAGE_SIZE}`)
    const batch = (env.data as Array<Record<string, unknown>>) ?? []
    if (!date && batch[0]?.Date) date = String(batch[0].Date).slice(0, 10)
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) break
    if (typeof env.recordsTotal === 'number' && rows.length >= env.recordsTotal) break
    if (start > 20_000) break
  }
  return { rows, date }
}

interface HistorySession {
  date: string
  stocks: Record<string, { fbuy: number; fsell: number; close: number }>
}

function mergeHistory(existing: { sessions: HistorySession[] }, session: HistorySession): { sessions: HistorySession[] } {
  const others = existing.sessions.filter((s) => s.date !== session.date)
  const sessions = [...others, session].sort((a, b) => a.date.localeCompare(b.date)).slice(-HISTORY_SESSIONS)
  return { sessions }
}

function atomicWrite(file: string, payload: unknown): void {
  mkdirSync(OUT_DIR, { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(payload))
  renameSync(tmp, file)
}

async function main() {
  // Headed mode required: Cloudflare fingerprints headless Chrome.
  const browser = await chromium.launch({ channel: 'chrome', headless: false })
  try {
    const page = await browser.newPage({ locale: 'en-US' })
    await warmup(page)

    // 1) Full-universe trading summary (OHLCV + foreign flows).
    const stock = await fetchAllRows(
      page,
      'https://www.idx.co.id/primary/TradingSummary/GetStockSummary?periodType=All&language=en-us',
    )
    const stocks = stock.rows.map(toRow).filter((r) => r.code)
    if (stocks.length === 0) throw new Error('no stock-summary rows returned')
    const tradeDate = stock.date ?? new Date().toISOString().slice(0, 10)

    atomicWrite(join(OUT_DIR, 'saham-latest.json'), {
      capturedAt: new Date().toISOString(),
      source: 'idx.co.id TradingSummary/GetStockSummary',
      tradeDate,
      count: stocks.length,
      rows: stocks,
    })

    // 2) Rolling foreign-flow history (dedupe by session date).
    const session: HistorySession = {
      date: tradeDate,
      stocks: Object.fromEntries(stocks.map((r) => [r.code, { fbuy: r.foreignBuy, fsell: r.foreignSell, close: r.close }])),
    }
    let history: { sessions: HistorySession[] } = { sessions: [] }
    try {
      history = JSON.parse(readFileSync(join(OUT_DIR, 'foreign-history.json'), 'utf8')) as typeof history
    } catch { /* first run */ }
    const merged = mergeHistory(history, session)
    atomicWrite(join(OUT_DIR, 'foreign-history.json'), merged)

    // 3) Market-wide broker board (single call, ~88 firms).
    let brokers: Array<Record<string, unknown>> = []
    try {
      const bEnv = await gotoJson(
        page,
        'https://www.idx.co.id/primary/TradingSummary/GetBrokerSummary?start=0&length=200&periodType=All&language=en-us',
      )
      brokers = ((bEnv.data as Array<Record<string, unknown>>) ?? []).map((d) => ({
        firm: String(d.IDFirm ?? ''),
        name: String(d.FirmName ?? ''),
        volume: num(d.Volume),
        value: num(d.Value),
        freq: num(d.Frequency),
      }))
    } catch { /* broker board is best-effort */ }
    if (brokers.length > 0) {
      atomicWrite(join(OUT_DIR, 'brokers-latest.json'), {
        capturedAt: new Date().toISOString(),
        tradeDate,
        count: brokers.length,
        rows: brokers,
      })
    }

    console.log(
      `[idx-saham] ${stocks.length} stocks (${tradeDate}) · history ${merged.sessions.length} sessions · brokers ${brokers.length}`,
    )
  } finally {
    await browser.close()
  }
}

main().catch(async (err) => {
  const msg = err instanceof Error ? err.message : err
  console.error('[idx-saham] harvest failed:', msg)
  await notifyAlert('IDX saham harvest FAILED', String(msg))
  process.exit(1)
})
