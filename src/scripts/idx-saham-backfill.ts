// ─────────────────────────────────────────────────────────────
// IDX Saham Backfill — fetch historical daily trading summaries
// (weekday sessions, ~90 calendar days) into IdxSahamSession.
//
// Uses the `date` param on GetStockSummary (verified: returns
// 963 rows per weekday, respects YYYY-MM-DD).
//
// Run: xvfb-run -a npx tsx src/scripts/idx-saham-backfill.ts [days]
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { chromium, type Page } from 'playwright'
import { prisma } from '@/lib/db'

const WARMUP_URL = 'https://www.idx.co.id/listed-companies/company-list'
const BASE = 'https://www.idx.co.id/primary/TradingSummary/GetStockSummary'
const PAGE_SIZE = 1000

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

async function warmup(page: Page): Promise<void> {
  await page.goto(WARMUP_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(3000)
}

async function gotoJson(page: Page, url: string): Promise<Record<string, unknown>> {
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  const text = await res?.text()
  if (!text) throw new Error('empty response')
  try { return JSON.parse(text) as Record<string, unknown> } catch { throw new Error(`non-JSON (CF page?): ${text.slice(0, 100)}`) }
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number.parseFloat(String(v ?? '')) || 0)

async function fetchDateRows(page: Page, date: string): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = []
  for (let start = 0; ; start += PAGE_SIZE) {
    const env = await gotoJson(page, `${BASE}?date=${date}&language=en-us&start=${start}&length=${PAGE_SIZE}`)
    const batch = (env.data as Array<Record<string, unknown>>) ?? []
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) break
    if (typeof env.recordsTotal === 'number' && rows.length >= env.recordsTotal) break
    if (start > 20_000) break
  }
  return rows
}

function weekdayDatesBack(days: number): string[] {
  const out: string[] = []
  const now = new Date()
  for (let i = 1; i <= days; i++) {
    const d = new Date(now)
    d.setDate(now.getDate() - i)
    const dow = d.getDay()
    if (dow === 0 || dow === 6) continue
    out.push(d.toISOString().slice(0, 10))
  }
  return out.reverse()
}

async function main() {
  const daysArg = Number(process.argv[2] ?? '90')
  const days = Math.min(Math.max(1, daysArg), 200)
  const dates = weekdayDatesBack(days)
  console.log(`[idx-backfill] fetching ${dates.length} weekday sessions (last ${days} calendar days)`)

  const browser = await chromium.launch({ channel: 'chromium', headless: false })
  try {
    const page = await browser.newPage({ locale: 'en-US' })
    await warmup(page)

    let totalSessions = 0
    for (const date of dates) {
      try {
        const raw = await fetchDateRows(page, date)
        if (raw.length === 0) {
          console.log(`[idx-backfill] ${date}: 0 rows (holiday?) — skipped`)
          continue
        }
        const mapped = raw.map((d) => ({
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
        })).filter((r) => r.code)

        await prisma.$transaction(async (tx) => {
          for (const s of mapped) {
            await tx.idxSahamSession.upsert({
              where: { code_tradeDate: { code: s.code, tradeDate: date } },
              create: { ...s, tradeDate: date },
              update: { ...s, tradeDate: date },
            })
          }
        })
        totalSessions += mapped.length
        console.log(`[idx-backfill] ${date}: ${mapped.length} rows ✓`)
      } catch (err) {
        console.error(`[idx-backfill] ${date}: FAILED — ${(err as Error).message.slice(0, 80)}`)
      }
      await delay(1500)
    }
    console.log(`[idx-backfill] DONE — ${totalSessions} total session rows written`)
  } finally {
    await browser.close()
    await prisma.$disconnect()
  }
}
main().catch(async (err) => {
  const msg = err instanceof Error ? err.message : err
  console.error(`[idx-backfill] FATAL: ${msg}`)
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
