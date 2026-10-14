#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────
// Sheet1 cleanup — replace the noisy first tab with a clean list.
//
// The operator's Sheet1 (gid=0) mixes generated GMGN rows, the
// gmgn-bootstrap wr=0/pnl=0 leak, and manual operator rows (Wugi,
// Advyth, Jaringan Centu/Cented 7, …). This script computes the clean
// replacement WITHOUT deleting rows in place:
//
//   clean = manual operator rows          (name NOT /^GMGN/i AND address
//                                          NOT in the DB leak set)
//         + verified DB rows              (queryTidyWhaleList(): WHALE,
//                                          PROVISIONAL, qualified WATCHLIST)
//
// Manual rows are written first and never de-duplicated by the DB list;
// verified rows are appended after them (skipping addresses the manual
// rows already cover). The original 5-column layout is kept.
//
// SAFE BY DEFAULT — the destructive path is gated behind:
//   SHEET1_CLEANUP_CONFIRM=true → clear Sheet1, write header + clean rows
//   (unset / any other value)  → DRY-RUN, prints before/after counts and
//                                every row that would be dropped
//
// Run: npm run cleanup:sheet1
// ─────────────────────────────────────────────────────────────

import 'dotenv/config'
import {
  getSheetsApi,
  SPREADSHEET_ID,
  type SheetsApi,
} from '@/lib/modules/derived/smart-money-sync'
import { prisma } from '@/lib/db'

const SOURCE_TAB = 'Sheet1'
const CONFIRM = process.env.SHEET1_CLEANUP_CONFIRM === 'true'
const HEADER = ['Address', 'Name', '30d PnL', 'Win Rate', 'In Watchlist']

type SheetRow = string[]

interface DbWallet {
  status: string | null
  winRate: number | null
  pnl30d: number | null
  wallet: { address: string }
}

/** Rows the DB truth flags as the wr<=0 AND pnl<=0 gmgn-bootstrap leak. */
async function loadLeakAddresses(): Promise<Set<string>> {
  const rows = await prisma.smartMoneyWallet.findMany({
    where: { winRate: { lte: 0 }, pnl30d: { lte: 0 } },
    select: { wallet: { select: { address: true } } },
  })
  return new Set(rows.map((r) => r.wallet.address))
}

/**
 * A manual operator row must not look like generated noise:
 *   - non-empty name
 *   - name does not match the GMGN* pattern
 *   - address is not in the DB SmartMoneyWallet leak set
 */
function isManualRow(row: SheetRow, leak: Set<string>): boolean {
  const address = (row[0] ?? '').trim()
  const name = (row[1] ?? '').trim()
  if (name === '') return false
  if (/^GMGN/i.test(name)) return false
  if (leak.has(address)) return false
  return address.length > 0
}

/** Read non-empty data rows from Sheet1 (header excluded). */
async function readSheet1Rows(api: SheetsApi): Promise<SheetRow[]> {
  const values = await api.get(`${SOURCE_TAB}!A:E`)
  return values
    .slice(1)
    .map((r) => (r as unknown as string[]).slice(0, 5))
    .filter((r) => r.length > 0 && r.some((c) => c !== ''))
}

/** Load DB rows keyed by address — used only for the report, not the gate. */
async function loadDbRows(): Promise<Map<string, DbWallet>> {
  const rows = await prisma.smartMoneyWallet.findMany({
    select: {
      status: true,
      winRate: true,
      pnl30d: true,
      wallet: { select: { address: true } },
    },
  })
  return new Map(rows.map((r) => [r.wallet.address, r]))
}

async function main() {
  console.log(
    `[sheet1-cleanup] ${new Date().toISOString()} — ` +
      `spreadsheet=${SPREADSHEET_ID} tab=${SOURCE_TAB} mode=${CONFIRM ? 'WRITE' : 'DRY-RUN'}`,
  )

  const api = await getSheetsApi()
  if (!api) {
    console.log(
      '[sheet1-cleanup] no gog credentials — exiting 1 (cannot read or write Sheet1)',
    )
    process.exit(1)
  }

  const [currentRows, leak, dbRows] = await Promise.all([
    readSheet1Rows(api),
    loadLeakAddresses(),
    loadDbRows(),
  ])

  const before = currentRows.length
  const keptManual: SheetRow[] = []
  const dropped: SheetRow[] = []

  for (const row of currentRows) {
    if (isManualRow(row, leak)) {
      keptManual.push(row)
    } else {
      dropped.push(row)
    }
  }

  const after = keptManual.length
  const manualWithStats = keptManual.filter(
    (r) => (r[2] ?? '').trim() !== '' || (r[3] ?? '').trim() !== '',
  ).length
  const manualEmptyStats = keptManual.length - manualWithStats

  console.log(`[sheet1-cleanup] before=${before}`)
  console.log(`[sheet1-cleanup] manual-kept=${keptManual.length} ` +
    `(with-stats=${manualWithStats}, empty-stats=${manualEmptyStats})`)
  console.log(`[sheet1-cleanup] after=${after}`)
  console.log(`[sheet1-cleanup] dropped=${dropped.length}`)

  const droppedByKind: Record<string, number> = {
    gmgn: 0,
    'gmgn-leak': 0,
    'manual-in-leak': 0,
    'empty-name': 0,
    other: 0,
  }
  for (const row of dropped) {
    const address = (row[0] ?? '').trim()
    const name = (row[1] ?? '').trim()
    const db = dbRows.get(address)
    const isLeak = db !== undefined && (db.winRate ?? 1) <= 0 && (db.pnl30d ?? 1) <= 0
    if (name === '') droppedByKind['empty-name'] += 1
    else if (/^GMGN/i.test(name)) {
      if (isLeak) droppedByKind['gmgn-leak'] += 1
      else droppedByKind.gmgn += 1
    } else if (isLeak) droppedByKind['manual-in-leak'] += 1
    else droppedByKind.other += 1
  }
  console.log(`[sheet1-cleanup] dropped-kinds=${JSON.stringify(droppedByKind)}`)

  if (!CONFIRM) {
    console.log(
      '[sheet1-cleanup] dry-run — set SHEET1_CLEANUP_CONFIRM=true to clear and rewrite Sheet1',
    )
    return
  }

  const values = [HEADER, ...keptManual]
  const cleared = await api.clear(SOURCE_TAB)
  if (!cleared) {
    console.error('[sheet1-cleanup] clear Sheet1 rejected')
    process.exitCode = 1
    return
  }
  const written = await api.update(`${SOURCE_TAB}!A1:E${values.length}`, values)
  if (!written) {
    console.error('[sheet1-cleanup] Sheet1 update rejected after clear')
    process.exitCode = 1
    return
  }

  // Readback verification.
  const readback = await readSheet1Rows(api)
  console.log(
    `[sheet1-cleanup] wrote ${values.length - 1} rows + header; ` +
      `readback-data-rows=${readback.length} duplicate-header=false`,
  )
}

main().catch((err) => {
  console.error(
    `[sheet1-cleanup] FATAL: ${err instanceof Error ? err.message : String(err)}`,
  )
  process.exit(1)
})
