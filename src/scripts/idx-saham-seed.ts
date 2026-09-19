#!/usr/bin/env node
// -------------------------------------------------------------
// Seed IdxSahamSession from the TradingView indonesia scanner.
// Full OHLCV + value + derived prev/change — only foreign flows
// stay zero (IDX-exclusive, honestly degraded until block lifts).
// update:{} never overwrites real session rows (IDX harvest wins).
// Run: npm run seed:idx-saham
// -------------------------------------------------------------

import 'dotenv/config'
import { z } from 'zod'
import { prisma } from '@/lib/db'

const SCAN_URL = 'https://scanner.tradingview.com/indonesia/scan'
const MAX_ROWS = 20_000

const ScanResponse = z.object({
  totalCount: z.number(),
  data: z.array(z.object({ s: z.string(), d: z.unknown().optional() })),
})

async function main() {
  // Market closed Sat/Sun — weekend seed masks Friday real session.
  const dow = new Date().getUTCDay()
  if (dow === 0 || dow === 6) {
    console.log('[seed] SKIP — market closed (weekend)')
    await prisma.$disconnect()
    return
  }
  const res = await fetch(SCAN_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(40_000),
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
    },
    body: JSON.stringify({
      filter: [{ left: 'type', operation: 'equal', right: 'stock' }],
      options: { lang: 'en' },
      columns: ['description', 'open', 'high', 'low', 'close', 'volume', 'Value.Traded', 'change'],
      range: [0, MAX_ROWS],
    }),
  })
  if (!res.ok) throw new Error(`indonesia scan HTTP ${res.status}`)
  const parsed = ScanResponse.parse(await res.json())

  const tradeDate = new Date().toISOString().slice(0, 10)
  let count = 0

  await prisma.$transaction(async (tx) => {
    for (const item of parsed.data) {
      if (!item.s.startsWith('IDX:')) continue
      const d = Array.isArray(item.d) ? (item.d as unknown[]) : []
      const code = item.s.slice(4).trim().toUpperCase()
      const close = typeof d[4] === 'number' && Number.isFinite(d[4]) ? d[4] : null
      if (!code || !close || close <= 0) continue
      const chg = typeof d[7] === 'number' && Number.isFinite(d[7]) ? d[7] : 0
      const prev = chg !== -100 ? close / (1 + chg / 100) : close
      await tx.idxSahamSession.upsert({
        where: { code_tradeDate: { code, tradeDate } },
        create: {
          code,
          tradeDate,
          name: typeof d[0] === 'string' ? d[0] : '',
          prev,
          open: typeof d[1] === 'number' ? d[1] : close,
          high: typeof d[2] === 'number' ? d[2] : close,
          low: typeof d[3] === 'number' ? d[3] : close,
          close,
          change: chg,
          volume: typeof d[5] === 'number' ? Math.round(d[5]) : 0,
          value: typeof d[6] === 'number' ? Math.round(d[6]) : 0,
          freq: 0,
          foreignBuy: 0,
          foreignSell: 0,
        },
        update: {}, // don't overwrite real session data if it exists
      })
      count++
    }
  })

  console.log(`[seed] ${count} enriched session rows (OHLCV+value, flows zero) tradeDate ${tradeDate}`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('[seed] failed:', e instanceof Error ? e.message : e)
  await prisma.$disconnect()
  process.exit(1)
})
