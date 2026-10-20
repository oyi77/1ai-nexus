// ─────────────────────────────────────────────────────────────
// Whale-buy scanner → Google Sheet sync.
//
// The scanner DB (`WalletBuySignal`, source='whale-buy-scanner') is the
// source of truth. This module mirrors it into dedicated tabs as a FULL
// REWRITE — never an append — so stale candidates disappear when the
// scanner prunes them.
//
// Write strategy (measured against the live API, not assumed):
//   • ONE atomic `values:batchUpdate` per tab. A separate `clear` opened a
//     window where a killed process left the tab empty; Sheets applies a
//     values batch all-or-nothing (an invalid range aborts the whole call).
//   • Stale tail rows are blanked in that same call, so a shrinking payload
//     still shrinks the tab.
//   • Unchanged payloads are skipped entirely (hash in StateMeta), so an
//     idle scanner costs zero write quota.
//
// Invariants:
//   • NEVER-FAIL — every error is logged and swallowed; the cron continues.
//   • Credentials absent → returns {written:0, skipped:false}, no throw.
//   • Pure mapping + range building are exported so they can be tested.
// ─────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto'
import { getSheetsApi, type SheetsApi } from '@/lib/modules/derived/smart-money-sync'
import { loadStateMeta, saveStateMeta } from '@/lib/modules/derived/db-state-meta'
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
  'Sources',
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
      Object.entries(w.sources ?? {})
        .map(([k, v]) => `${k}:${v}`)
        .join(' '),
    ]),
  ]
}

/** Column letter (A..Z) for a 1-based column index. */
function colLetter(index: number): string {
  return String.fromCharCode('A'.charCodeAt(0) + index - 1)
}

/**
 * Last known row count per tab, so a shorter payload blanks the stale tail.
 * In-process only: after a restart the first pass may over-clear, which is
 * harmless in a full rewrite — the invariant that matters is never to
 * under-clear.
 */
const lastRowCount = new Map<string, number>()

/**
 * Build the range list for a full tab rewrite as ONE atomic request.
 *
 * Writing only `A1:<rows>` leaves older, longer content behind, and a separate
 * `clear` opens a window where the tab is empty if the process dies in
 * between (observed: a killed scan left the tab blank). Instead we write the
 * live rows plus an explicit blank block covering every row that previously
 * existed — all in one `values:batchUpdate`, which Sheets applies atomically
 * (verified live: an invalid range aborts the whole call and leaves prior
 * data untouched).
 *
 * Pure — exported for tests.
 */
export function buildRewriteRanges(
  tab: string,
  columnCount: number,
  values: string[][],
  previousRows: number,
): Array<{ range: string; values: string[][] }> {
  const lastCol = colLetter(columnCount)
  const dataRows = values.length
  const staleRows = Math.max(0, previousRows - dataRows)
  const ranges: Array<{ range: string; values: string[][] }> = [
    { range: `${tab}!A1:${lastCol}${dataRows}`, values },
  ]

  if (staleRows > 0) {
    ranges.push({
      range: `${tab}!A${dataRows + 1}:${lastCol}${dataRows + staleRows}`,
      values: Array.from({ length: staleRows }, () =>
        Array.from({ length: columnCount }, () => ''),
      ),
    })
  }
  return ranges
}

/**
 * Full-rewrite one tab in a single atomic request. Idempotent (the tab is
 * created when absent) and never throws.
 */
async function rewriteTab(
  sheets: SheetsApi,
  tab: string,
  columnCount: number,
  values: string[][],
): Promise<boolean> {
  const previousRows = lastRowCount.get(tab) ?? 0
  const ranges = buildRewriteRanges(tab, columnCount, values, previousRows)

  try {
    // Tab creation is a separate schema op and harmless to repeat: Sheets
    // rejects a duplicate title, which the helper reports as `false`.
    await sheets.batchUpdate([{ addSheet: { properties: { title: tab } } }])

    const written = await sheets.batchUpdateValues(ranges)
    if (!written) {
      console.error(`[whale-sheet-sync] atomic rewrite rejected on ${tab}`)
      return false
    }
    lastRowCount.set(tab, values.length)
    return true
  } catch (err) {
    console.error(
      `[whale-sheet-sync] rewrite failed on ${tab}: ${err instanceof Error ? err.message : String(err)}`,
    )
    return false
  }
}

export interface SheetSyncResult {
  /** Data rows now present on the tab (excluding the header). */
  written: number
  /** True when the payload matched the last push, so no API write was made. */
  skipped: boolean
}

/** Hash of the exact payload, so an idle scanner never re-writes the sheet. */
function payloadHash(tab: string, values: string[][]): string {
  return createHash('sha256').update(JSON.stringify({ tab, values })).digest('hex')
}

/**
 * Full-rewrite one tab, skipping the write entirely when the content is
 * unchanged. The hash lives in `StateMeta` (scope `whale-sheet-sync`) so the
 * gate survives restarts — the cron is a fresh process on every pass.
 */
async function rewriteTabIfChanged(
  sheets: SheetsApi,
  tab: string,
  columnCount: number,
  values: string[][],
): Promise<SheetSyncResult> {
  const hash = payloadHash(tab, values)
  const state = await loadStateMeta<Record<string, { hash?: string }>>('whale-sheet-sync')
  if (state?.[tab]?.hash === hash) {
    return { written: values.length - 1, skipped: true }
  }

  const ok = await rewriteTab(sheets, tab, columnCount, values)
  if (!ok) return { written: 0, skipped: false }

  await saveStateMeta('whale-sheet-sync', { ...(state ?? {}), [tab]: { hash } })
  return { written: values.length - 1, skipped: false }
}

/**
 * Mirror the scanner's current candidates into `WhaleScanner`.
 *
 * `api` is a test seam: omit it to resolve credentials, pass `null` to assert
 * the credential-less path (tests must never touch the real sheet).
 */
export async function syncWhaleScanSheet(
  rows: WhaleBuyRow[],
  api?: SheetsApi | null,
): Promise<SheetSyncResult> {
  const sheets = api === undefined ? await getSheetsApi().catch(() => null) : api
  if (!sheets) {
    console.warn('[whale-sheet-sync] no gog credentials — sheet not updated')
    return { written: 0, skipped: false }
  }
  return rewriteTabIfChanged(
    sheets,
    WHALE_SCAN_TAB,
    WHALE_SCAN_HEADER.length,
    whaleBuysToSheetValues(rows),
  )
}

/**
 * Mirror the persistent whale-wallet registry into `WhaleWallets`.
 * Same never-fail contract as `syncWhaleScanSheet`.
 */
export async function syncWhaleWalletSheet(
  wallets: WhaleWalletRecord[],
  api?: SheetsApi | null,
): Promise<SheetSyncResult> {
  const sheets = api === undefined ? await getSheetsApi().catch(() => null) : api
  if (!sheets) {
    console.warn('[whale-sheet-sync] no gog credentials — wallet tab not updated')
    return { written: 0, skipped: false }
  }
  return rewriteTabIfChanged(
    sheets,
    WHALE_WALLET_TAB,
    WHALE_WALLET_HEADER.length,
    whaleWalletsToSheetValues(wallets),
  )
}
