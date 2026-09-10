#!/usr/bin/env node
// -------------------------------------------------------------
// Seed IdxSahamSession from existing screener data.
// Uses screener price as close, zero foreign flows (unknown).
// This gives the watchlist-ideas endpoint real data to work with
// before the browser harvester runs.
// -------------------------------------------------------------

import 'dotenv/config'
import { prisma } from '@/lib/db'

async function main() {
  const latest = await prisma.idxScreenerSnapshot.findFirst({
    orderBy: { snapshotDate: 'desc' },
    select: { snapshotDate: true },
  })
  if (!latest) {
    console.error('No screener data to seed from. Run harvest:idx-screener first.')
    process.exit(1)
  }

  const rows = await prisma.idxScreenerSnapshot.findMany({
    where: { snapshotDate: latest.snapshotDate },
  })

  const tradeDate = latest.snapshotDate
  let count = 0

  await prisma.$transaction(async (tx) => {
    for (const r of rows) {
      if (!r.price || r.price <= 0) continue
      await tx.idxSahamSession.upsert({
        where: { code_tradeDate: { code: r.code, tradeDate } },
        create: {
          code: r.code,
          tradeDate,
          name: r.name,
          prev: r.price,
          open: r.price,
          high: r.price,
          low: r.price,
          close: r.price,
          change: 0,
          volume: 0,
          value: 0,
          freq: 0,
          foreignBuy: 0,
          foreignSell: 0,
        },
        update: {}, // don't overwrite real session data if it exists
      })
      count++
    }
  })

  console.log(`[seed] ${count} session rows from screener ${tradeDate}`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('FAIL:', e.message)
  await prisma.$disconnect()
  process.exit(1)
})
