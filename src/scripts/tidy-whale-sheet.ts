#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────
// Tidy whale sheet — write a clean whale list to a NEW tab.
//
// Source of truth is the DB (SmartMoneyWallet joined to Wallet),
// NOT the noisy operator sheet. Qualification:
//   - status IN ('WHALE', 'PROVISIONAL')
//   - OR (status = 'WATCHLIST' AND winRate > 0.6 AND pnl30d > 0.7)
//
// Output tab: `WhaleList_Clean` on the SAME spreadsheet that
// smart-money-sync.ts already targets (SPREADSHEET_ID). The operator's
// existing tabs are never touched — only WhaleList_Clean is created
// (ignored if it already exists) and fully rewritten, so re-runs never
// append duplicates.
//
// Dry-run by default: env TIDY_WHALE_SHEET_WRITE=true is required to
// actually write. Missing gog credentials never throw — we log and exit 0.
//
// Run: npm run tidy:whale-sheet
// ─────────────────────────────────────────────────────────────

import 'dotenv/config'
import { prisma } from '@/lib/db'
import {
  getSheetsApi,
  SPREADSHEET_ID,
  type SheetsApi,
} from '@/lib/modules/derived/smart-money-sync'

const TIDY_TAB = 'WhaleList_Clean'
const HEADER = ['Address', 'Name/Alias', 'Status', 'WinRate%', 'Pnl30d%', 'Source', 'Labels']

interface TidyWhaleRow {
  address: string
  name: string
  status: string
  winRate: number | null
  pnl30d: number | null
  category: string
  labels: string[]
}

const STATUS_ORDER: Record<string, number> = {
  WHALE: 0,
  PROVISIONAL: 1,
  WATCHLIST: 2,
}

function toSheetRow(row: TidyWhaleRow): string[] {
  const name = row.name || (row.address.length > 12 ? `${row.address.slice(0, 6)}…${row.address.slice(-4)}` : row.address)
  const winRatePct = row.winRate === null || Number.isNaN(row.winRate) ? '' : (row.winRate * 100).toFixed(1)
  const pnl30dPct = row.pnl30d === null || Number.isNaN(row.pnl30d) ? '' : (row.pnl30d * 100).toFixed(1)
  const source = row.category || (row.labels.length > 0 ? row.labels.join(',') : '')
  return [
    row.address,
    name,
    row.status,
    winRatePct,
    pnl30dPct,
    source,
    row.labels.join(','),
  ]
}

/**
 * Query the DB for the tidy whale list.
 *
 * Qualification mirrors the task spec: WHALE/PROVISIONAL always qualify;
 * WATCHLIST only when it clears BOTH quality bars (> 0.6 win rate AND
 * > 0.7 pnl30d). Sort: WHALE first, then PROVISIONAL, then qualified
 * WATCHLIST; within each bucket by pnl30d desc (nulls last).
 */
export async function queryTidyWhaleList(): Promise<TidyWhaleRow[]> {
  const rows = await prisma.smartMoneyWallet.findMany({
    where: {
      OR: [
        { status: { in: ['WHALE', 'PROVISIONAL'] } },
        {
          status: 'WATCHLIST',
          winRate: { gt: 0.6 },
          pnl30d: { gt: 0.7 },
        },
      ],
    },
    select: {
      status: true,
      winRate: true,
      pnl30d: true,
      category: true,
      wallet: {
        select: { address: true, alias: true, labels: true },
      },
    },
  })

  const mapped: TidyWhaleRow[] = rows.map((r) => ({
    address: r.wallet.address,
    name: r.wallet.alias ?? '',
    status: r.status ?? 'UNKNOWN',
    winRate: r.winRate,
    pnl30d: r.pnl30d,
    category: r.category,
    labels: r.wallet.labels ?? [],
  }))

  return mapped.sort((a, b) => {
    const aRank = STATUS_ORDER[a.status] ?? 3
    const bRank = STATUS_ORDER[b.status] ?? 3
    if (aRank !== bRank) return aRank - bRank
    const aPnl = a.pnl30d ?? Number.NEGATIVE_INFINITY
    const bPnl = b.pnl30d ?? Number.NEGATIVE_INFINITY
    if (aPnl !== bPnl) return bPnl - aPnl
    return a.address.localeCompare(b.address)
  })
}

/** Write header + rows to the tidy tab (idempotent full rewrite). */
export async function writeTidyWhaleList(api: SheetsApi, rows: TidyWhaleRow[]): Promise<boolean> {
  // Ensure the tab exists; batchUpdate returns false (not throws) when
  // addSheet finds the title already taken, which is the normal re-run path.
  await api.batchUpdate([{ addSheet: { properties: { title: TIDY_TAB } } }])

  const values = [HEADER, ...rows.map(toSheetRow)]
  return api.update(`${TIDY_TAB}!A1:G${values.length}`, values)
}

async function main() {
  const writeEnabled = process.env.TIDY_WHALE_SHEET_WRITE === 'true'

  console.log(
    `[tidy-whale-sheet] ${new Date().toISOString()} — ` +
      `spreadsheet=${SPREADSHEET_ID} tab=${TIDY_TAB} write=${writeEnabled ? 'true' : 'dry-run'}`,
  )

  let rows: TidyWhaleRow[]
  try {
    rows = await queryTidyWhaleList()
  } catch (err) {
    console.error(
      `[tidy-whale-sheet] DB query failed: ${err instanceof Error ? err.message : String(err)}`,
    )
    process.exit(1)
  }

  console.log(`[tidy-whale-sheet] total rows=${rows.length}`)

  if (!writeEnabled) {
    console.log('[tidy-whale-sheet] dry-run — set TIDY_WHALE_SHEET_WRITE=true to write')
    process.exit(0)
  }

  // Missing gog credentials must never throw the script.
  let api: SheetsApi | null = null
  try {
    api = await getSheetsApi()
  } catch (err) {
    console.error(
      `[tidy-whale-sheet] gog auth failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  if (!api) {
    console.log(
      '[tidy-whale-sheet] no gog credentials — exiting 0 without writing ' +
        '(set GOG_KEYRING_PASSWORD to enable writes)',
    )
    process.exit(0)
  }

  try {
    const ok = await writeTidyWhaleList(api, rows)
    if (!ok) {
      console.error('[tidy-whale-sheet] sheet update rejected')
      process.exit(1)
    }
    console.log(`[tidy-whale-sheet] wrote ${rows.length} rows + header to ${TIDY_TAB}`)
    process.exit(0)
  } catch (err) {
    console.error(
      `[tidy-whale-sheet] sheet write failed: ${err instanceof Error ? err.message : String(err)}`,
    )
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('[tidy-whale-sheet] FATAL:', err)
  process.exit(1)
})
