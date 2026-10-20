// ─────────────────────────────────────────────────────────────
// Whale-buy scanner → Google Sheet sync.
//
// The scanner DB (`WalletBuySignal`, source='whale-buy-scanner') is the
// source of truth. This module mirrors it into a dedicated sheet tab on
// every pass so the operator always sees exactly what the scanner caught —
// a FULL REWRITE (clear + write), never an append, so stale candidates
// disappear when the scanner prunes them.
//
// Invariants:
//   • NEVER-FAIL — every error is logged and swallowed; the cron continues.
//   • The tab is created once, then reused.
//   • Credentials absent → returns 0 rows written, no throw.
//   • Pure row-mapping (`whaleBuysToSheetValues`) is exported for tests.
// ─────────────────────────────────────────────────────────────

import { getSheetsApi, type SheetsApi } from '@/lib/modules/derived/smart-money-sync'
import type { WhaleBuyRow } from '@/lib/modules/derived/whale-buy-store'
import type { WhaleWalletRecord } from '@/lib/modules/derived/whale-wallet-registry'

export const WHALE_SCAN_TAB = process.env.WHALE_SCAN_TAB || 'WhaleScanner'

export const WHALE_SCAN_HEADER = [
  'Contract',
  'Chain',
  'Buyers',
  'Volume USD',
  'Buy Count',
  'First Buy (UTC)',
  'Last Buy (UTC)',
] as const

export const WHALE_WALLET_TAB = process.env.WHALE_WALLET_TAB || 'WhaleWallets'

export const WHALE_WALLET_HEADER = [
  'Address',
  'Alias',
  'Status',
  'Win Rate %',
  'PnL 30d %',
  'Labels',
  'Times Caught',
  'First Caught (UTC)',
  'Last Caught (UTC)',
  'Tokens',
] as const

function fmtUtc(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return ''
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19)
}

function fmtUsd(v: number): string {
  if (!Number.isFinite(v)) return '0'
  return v.toFixed(2)
}

/**
 * Map scanner rows to sheet values (header first). Rows are sorted by
 * volume desc so the biggest whale buys stay at the top of the tab.
 * Pure — no I/O, no mutation of the input.
 */
export function whaleBuysToSheetValues(rows: WhaleBuyRow[]): string[][] {
  const sorted = [...rows].sort((a, b) => b.buyVolumeUsd - a.buyVolumeUsd)
  return [
    [...WHALE_SCAN_HEADER],
    ...sorted.map((r) => [
      r.contract,
      r.chain,
      (r.buyers ?? []).join(', '),
      fmtUsd(r.buyVolumeUsd),
      String(r.buyCount ?? 0),
      fmtUtc(r.firstBuyAt),
      fmtUtc(r.lastBuyAt),
    ]),
  ]
}

function fmtPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return ''
  return (v * 100).toFixed(1)
}

/**
 * Map the persistent whale-wallet registry to sheet values (header first).
 *
 * Sorted by catch count desc, then most recently caught — so the whales the
 * scanner keeps catching stay on top. Pure.
 */
export function whaleWalletsToSheetValues(wallets: WhaleWalletRecord[]): string[][] {
  const sorted = [...wallets].sort(
    (a, b) => b.timesCaught - a.timesCaught || b.lastCaughtAt - a.lastCaughtAt,
  )
  return [
    [...WHALE_WALLET_HEADER],
    ...sorted.map((w) => [
      w.address,
      w.alias ?? '',
      w.status ?? '',
      fmtPct(w.winRate),
      fmtPct(w.pnl30d),
      (w.labels ?? []).join(','),
      String(w.timesCaught),
      fmtUtc(w.firstCaughtAt),
      fmtUtc(w.lastCaughtAt),
      (w.tokens ?? []).join(', '),
    ]),
  ]
}

/** Column letter (A..Z) for a 1-based column index. */
function colLetter(index: number): string {
  return String.fromCharCode('A'.charCodeAt(0) + index - 1)
}

/**
 * Full-rewrite one tab: clear it, then write header + rows.
 * Idempotent — the tab is created when absent. Never throws.
 */
async function rewriteTab(
  sheets: SheetsApi,
  tab: string,
  columnCount: number,
  values: string[][],
): Promise<boolean> {
  const lastCol = colLetter(columnCount)
  try {
    await sheets.batchUpdate([{ addSheet: { properties: { title: tab } } }])
    const cleared = await sheets.clear(`${tab}!A:${lastCol}`)
    if (!cleared) console.warn(`[whale-sheet-sync] clear rejected on ${tab} — overwriting`)
    const written = await sheets.update(`${tab}!A1:${lastCol}${values.length}`, values)
    if (!written) {
      console.error(`[whale-sheet-sync] update rejected on ${tab}`)
      return false
    }
    return true
  } catch (err) {
    console.error(
      `[whale-sheet-sync] write failed on ${tab}: ${err instanceof Error ? err.message : String(err)}`,
    )
    return false
  }
}

/**
 * Full-rewrite the whale scanner tab with `rows`.
 *
 * Clears the tab, then writes header + rows. When `rows` is empty the tab is
 * cleared and a header-only sheet is written, so the operator can tell
 * "scanner ran, found nothing" apart from "sync never ran".
 *
 * `api` is a test seam: omit it to resolve credentials, pass `null` to assert
 * the credential-less path (used by tests so they never touch the real sheet).
 *
 * Returns the number of DATA rows written (0 on any failure).
 */
export async function syncWhaleScanSheet(rows: WhaleBuyRow[], api?: SheetsApi | null): Promise<number> {
  const sheets = api === undefined ? await getSheetsApi().catch(() => null) : api
  if (!sheets) {
    console.warn('[whale-sheet-sync] no gog credentials — sheet not updated')
    return 0
  }

  const ok = await rewriteTab(sheets, WHALE_SCAN_TAB, WHALE_SCAN_HEADER.length, whaleBuysToSheetValues(rows))
  return ok ? rows.length : 0
}

/**
 * Full-rewrite the persistent whale-wallet tab (`WhaleWallets`) from the
 * registry. Same never-fail contract as `syncWhaleScanSheet`.
 */
export async function syncWhaleWalletSheet(
  wallets: WhaleWalletRecord[],
  api?: SheetsApi | null,
): Promise<number> {
  const sheets = api === undefined ? await getSheetsApi().catch(() => null) : api
  if (!sheets) {
    console.warn('[whale-sheet-sync] no gog credentials — wallet tab not updated')
    return 0
  }

  const ok = await rewriteTab(
    sheets,
    WHALE_WALLET_TAB,
    WHALE_WALLET_HEADER.length,
    whaleWalletsToSheetValues(wallets),
  )
  return ok ? wallets.length : 0
}
