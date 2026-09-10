// ─────────────────────────────────────────────────────────────
// IDX Saham Harvester — captures the daily IDX trading summary
// (full universe OHLCV + FOREIGN BUY/SELL volumes) plus the
// market-wide broker board, into PostgreSQL via Prisma.
//
// Why a browser: www.idx.co.id sits behind Cloudflare; plain
// server fetches 403 while a real Chromium context passes after
// the HTML page issues clearance cookies (verified via spike).
//
// Writes: IdxSahamSession (per stock per session),
//         IdxBrokerBoard (per firm per session).
// Run: npm run harvest:idx-saham     (one shot)
// Cron (17:40 WIB weekdays = 10:40 UTC):
//   40 10 * * 1-5 cd /home/openclaw/projects/1ai-tracker && xvfb-run -a npm run harvest:idx-saham >> /tmp/idx-saham-harvest.log 2>&1
// ─────────────────────────────────────────────────────────────

import 'dotenv/config'
import { chromium, type Page } from 'playwright'

import { prisma } from '@/lib/db'
import { notifyAlert } from '@/lib/config/alerting'

const WARMUP_URL = 'https://www.idx.co.id/listed-companies/company-list'
const PAGE_SIZE = 1000
const HISTORY_SESSIONS = 90

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Cloudflare clearance cookies are issued by the HTML page; bare API hits 403. */
async function warmup(page: Page): Promise<void> {
  await page.goto(WARMUP_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await delay(3000)
}

async function gotoJson(page: Page, url: string): Promise<Record<string, unknown>> {
  const res = await page.evaluate(async (u) => {
    const r = await fetch(u, { credentials: 'include' })
    return r.json()
  }, url)
  return res as Record<string, unknown>
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

async function main() {
  // Headed mode required: Cloudflare fingerprints headless Chrome.
  const browser = await chromium.launch({ channel: 'chromium', headless: false })
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

    // Upsert sessions in a single transaction.
    await prisma.$transaction(async (tx) => {
      for (const s of stocks) {
        await tx.idxSahamSession.upsert({
          where: { code_tradeDate: { code: s.code, tradeDate } },
          create: { ...s, tradeDate },
          update: { ...s, tradeDate },
        })
      }
    })

    // 2) Market-wide broker board (single call, ~88 firms).
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
      await prisma.$transaction(async (tx) => {
        for (const b of brokers) {
          await tx.idxBrokerBoard.upsert({
            where: { tradeDate_firm: { tradeDate, firm: b.firm as string } },
            create: { tradeDate, firm: b.firm as string, name: b.name as string, volume: b.volume as number, value: b.value as number, freq: b.freq as number },
            update: { name: b.name as string, volume: b.volume as number, value: b.value as number, freq: b.freq as number },
          })
        }
      })
    }

    console.log(`[idx-saham] ${stocks.length} stocks (${tradeDate}) · brokers ${brokers.length}`)
  } finally {
    await browser.close()
    await prisma.$disconnect()
  }
}

main().catch(async (err) => {
  const msg = err instanceof Error ? err.message : err
  console.error('[idx-saham] harvest failed:', msg)
  await notifyAlert('IDX saham harvest FAILED', String(msg))
  await prisma.$disconnect()
  process.exit(1)
})
