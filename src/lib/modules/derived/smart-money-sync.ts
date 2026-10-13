// ─────────────────────────────────────────────────────────────
// Smart Money Google Sheets Sync + Telegram Alert
//
// Operator workflow:
//   1. Operator maintains a Google Sheet of watched wallet addresses
//      (columns: Address, Name). This module READS that sheet to sync
//      wallet aliases into the DB.
//   2. After syncing wallets, this module queries the DB for recent
//      transactions by classified smart money wallets and WRITES a
//      results sheet (screening output: wallet, token, action, amount,
//      token age, MC, timestamp).
//   3. If any transaction matches the alert criteria (token age < 24h,
//      amount > $1000, MC < $1M), a Telegram notification is sent to
//      the sniper bot.
//
// Auth: uses a Google service account JSON (GOOGLE_APPLICATION_CREDENTIALS
// env var pointing to a JSON key file). If no creds are set, the module
// gracefully degrades — it still reads wallets from the DB and sends
// Telegram alerts, just skips the Sheet sync.
//
// Never-fail invariant: a Sheet API error or missing creds must never
// block the Telegram alert path.
// ─────────────────────────────────────────────────────────────

import { google, type sheets_v4 } from 'googleapis'
import { JWT } from 'google-auth-library'
import { prisma } from '@/lib/db'
import { existsSync, readFileSync } from 'node:fs'

/** The operator's spreadsheet ID (from the shared link). */
export const SPREADSHEET_ID = '14Kr-P8-DByM-jAw4ydo2x29YAp_LPc9uivHMidP6-78'

/** Sheet tab names. */
const WALLET_SOURCE_TAB = 'Wallets'      // operator input: Address, Name
const RESULTS_TAB = 'SmartMoneyActivity' // screening output

/** Alert thresholds (operator-specified). */
export const ALERT_THRESHOLDS = {
  maxTokenAgeHours: 24,
  minAmountUsd: 1000,
  maxMarketCapUsd: 1_000_000,
} as const

// ── Google Sheets auth ────────────────────────────────────────

let sheetsClient: sheets_v4.Sheets | null | undefined

function getSheetsClient(): sheets_v4.Sheets | null {
  if (sheetsClient !== undefined) return sheetsClient
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!keyPath || !existsSync(keyPath)) {
    sheetsClient = null
    return null
  }
  try {
    const key = JSON.parse(readFileSync(keyPath, 'utf8')) as {
      client_email: string
      private_key: string
    }
    const auth = new JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    })
    sheetsClient = google.sheets({ version: 'v4', auth })
    return sheetsClient
  } catch {
    sheetsClient = null
    return null
  }
}

// ── 1. Read wallet source sheet → sync to DB ──────────────────

export interface SheetWallet {
  address: string
  name: string
}

/**
 * Read the operator's wallet list from the Google Sheet.
 * Uses the public CSV export URL (no auth needed for publicly-shared sheets)
 * as primary, falling back to the authenticated Sheets API if creds exist.
 * Returns [] if both fail — never throws.
 */
export async function readWalletsFromSheet(): Promise<SheetWallet[]> {
  // ── Primary: public CSV export (no auth required) ──
  try {
    const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=0`
    const res = await fetch(url, { redirect: 'follow' })
    if (res.ok) {
      const csv = await res.text()
      const wallets = parseWalletCsv(csv)
      if (wallets.length > 0) return wallets
    }
  } catch (err) {
    console.error('[smart-money-sync] CSV export failed:', err instanceof Error ? err.message : String(err))
  }

  // ── Fallback: authenticated Sheets API ──
  const client = getSheetsClient()
  if (!client) return []
  try {
    const res = await client.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${WALLET_SOURCE_TAB}!A:B`,
    })
    const rows = res.data.values ?? []
    return parseWalletRows(rows)
  } catch (err) {
    console.error('[smart-money-sync] Sheet read failed:', err instanceof Error ? err.message : String(err))
    return []
  }
}

/** Parse CSV text into SheetWallet[] (skips header row). */
function parseWalletCsv(csv: string): SheetWallet[] {
  const lines = csv.split('\n')
  const wallets: SheetWallet[] = []
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line)
    const address = (cols[0] ?? '').trim()
    const name = (cols[1] ?? '').trim()
    if (address && address.length > 20) {
      wallets.push({ address, name })
    }
  }
  return wallets
}

/** Parse a single CSV line (handles quoted fields). */
function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i++ }
        else inQuotes = false
      } else {
        current += ch
      }
    } else {
      if (ch === '"') inQuotes = true
      else if (ch === ',') { result.push(current); current = '' }
      else current += ch
    }
  }
  result.push(current)
  return result
}

/** Parse Sheets API rows into SheetWallet[]. */
function parseWalletRows(rows: unknown[][]): SheetWallet[] {
  const wallets: SheetWallet[] = []
  for (const row of rows.slice(1)) {
    const address = String((row as string[])[0] ?? '').trim()
    const name = String((row as string[])[1] ?? '').trim()
    if (address && address.length > 20) {
      wallets.push({ address, name })
    }
  }
  return wallets
}

/**
 * Sync sheet wallets into the DB: upsert Wallet rows with alias from
 * the sheet. Does NOT touch SmartMoneyWallet classification — that's
 * the classifier's job.
 */
export async function syncWalletsFromSheet(): Promise<{ synced: number; newWallets: number }> {
  const sheetWallets = await readWalletsFromSheet()
  if (sheetWallets.length === 0) return { synced: 0, newWallets: 0 }

  let newWallets = 0
  for (const w of sheetWallets) {
    const result = await prisma.wallet.upsert({
      where: { address: w.address },
      create: {
        address: w.address,
        chain: 'solana',
        alias: w.name || null,
        labels: w.name ? [w.name] : [],
        lastSeen: new Date(),
      },
      update: {
        alias: w.name || undefined,
        lastSeen: new Date(),
      },
    }).then(() => 'ok' as const).catch(() => 'fail' as const)
    if (result === 'ok') newWallets++
  }
  return { synced: sheetWallets.length, newWallets }
}

// ── 2. Query recent smart money activity from DB ──────────────

export interface SmartMoneyTrade {
  walletAddress: string
  walletAlias: string | null
  walletStatus: string | null
  tokenSymbol: string | null
  tokenAddress: string
  chain: string
  action: string    // 'BUY' | 'SELL'
  amountUsd: number
  tokenAgeHours: number | null
  marketCapUsd: number | null
  timestamp: Date
}

/**
 * Query the DB for recent transactions by classified smart money wallets.
 * Returns trades from the last `hours` window.
 *
 * Transaction model has no buy/sell `type` field and no `token` relation.
 * Action is inferred from the `value` sign (negative = outflow = SELL) or
 * from `from`/`to` address matching. Token market cap and creation time are
 * looked up separately from the Token table by `tokenAddress`.
 */
export async function querySmartMoneyActivity(hours = 1): Promise<SmartMoneyTrade[]> {
  const since = new Date(Date.now() - hours * 3_600_000)

  // Get all classified smart money wallet IDs
  const smartWallets = await prisma.smartMoneyWallet.findMany({
    where: { status: { not: null } },
    select: {
      walletId: true,
      status: true,
      wallet: {
        select: { address: true, alias: true, chain: true },
      },
    },
  })

  if (smartWallets.length === 0) return []

  const walletIdMap = new Map(smartWallets.map((w) => [w.walletId, w]))

  // Fetch recent transactions for these wallets
  const txs = await prisma.transaction.findMany({
    where: {
      walletId: { in: [...walletIdMap.keys()] },
      timestamp: { gte: since },
      amountUsd: { gte: ALERT_THRESHOLDS.minAmountUsd },
    },
    orderBy: { timestamp: 'desc' },
    take: 500,
  })

  if (txs.length === 0) return []

  // Batch-lookup Token rows for market cap + creation time
  const tokenAddresses = [...new Set(txs.map((t) => t.tokenAddress).filter((a): a is string => !!a))]
  const tokenRows = tokenAddresses.length > 0
    ? await prisma.token.findMany({
        where: { address: { in: tokenAddresses } },
        select: { address: true, marketCap: true, createdAt: true },
      })
    : []
  const tokenMap = new Map(tokenRows.map((t) => [t.address, t]))

  const now = Date.now()
  const trades: SmartMoneyTrade[] = []

  for (const tx of txs) {
    const sm = walletIdMap.get(tx.walletId ?? '')
    if (!sm) continue

    const tokenRow = tx.tokenAddress ? tokenMap.get(tx.tokenAddress) : null
    const tokenAgeMs = tokenRow?.createdAt
      ? now - tokenRow.createdAt.getTime()
      : null
    const tokenAgeHours = tokenAgeMs !== null ? tokenAgeMs / 3_600_000 : null

    // Infer action: negative value = outflow = SELL; positive = inflow = BUY.
    // Fall back to `from`/`to` matching if value is zero (transfer with no USD).
    const walletAddr = sm.wallet.address
    let action: string
    if (tx.value < 0) {
      action = 'SELL'
    } else if (tx.value > 0) {
      action = 'BUY'
    } else if (tx.to && tx.to.toLowerCase() === walletAddr.toLowerCase()) {
      action = 'BUY'
    } else if (tx.from && tx.from.toLowerCase() === walletAddr.toLowerCase()) {
      action = 'SELL'
    } else {
      action = 'BUY' // conservative default for amount-only records
    }

    trades.push({
      walletAddress: sm.wallet.address,
      walletAlias: sm.wallet.alias,
      walletStatus: sm.status,
      tokenSymbol: tx.tokenSymbol,
      tokenAddress: tx.tokenAddress ?? '',
      chain: sm.wallet.chain,
      action,
      amountUsd: tx.amountUsd ?? 0,
      tokenAgeHours,
      marketCapUsd: tokenRow?.marketCap ?? null,
      timestamp: tx.timestamp,
    })
  }

  return trades
}

// ── 3. Filter trades matching alert criteria ──────────────────

export function filterAlertableTrades(trades: SmartMoneyTrade[]): SmartMoneyTrade[] {
  return trades.filter((t) => {
    // Token age < 24h (null = unknown → include conservatively)
    if (t.tokenAgeHours !== null && t.tokenAgeHours > ALERT_THRESHOLDS.maxTokenAgeHours) return false
    // Amount > $1000
    if (t.amountUsd < ALERT_THRESHOLDS.minAmountUsd) return false
    // MC < $1M (null = unknown → include conservatively)
    if (t.marketCapUsd !== null && t.marketCapUsd > ALERT_THRESHOLDS.maxMarketCapUsd) return false
    return true
  })
}

// ── 4. Write results to Google Sheet ──────────────────────────

/**
 * Append screening results to the SmartMoneyActivity sheet tab.
 * Creates the tab if it doesn't exist.
 */
export async function writeResultsToSheet(trades: SmartMoneyTrade[]): Promise<boolean> {
  if (trades.length === 0) return true
  const client = getSheetsClient()
  if (!client) return false

  try {
    // Ensure the results tab exists
    await client.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          addSheet: { properties: { title: RESULTS_TAB } },
        }],
      },
    }).catch(() => {}) // already exists → ignore error

    // Write header if empty
    const headerRange = await client.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${RESULTS_TAB}!A1:I1`,
    })
    if (!headerRange.data.values || headerRange.data.values.length === 0) {
      await client.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${RESULTS_TAB}!A1:I1`,
        valueInputOption: 'RAW',
        requestBody: { values: [[
          'Timestamp', 'Wallet', 'Alias', 'Status',
          'Action', 'Token', 'Amount USD', 'Token Age (h)', 'Market Cap USD',
        ]] },
      })
    }

    // Append rows
    const rows = trades.map((t) => [
      t.timestamp.toISOString(),
      t.walletAddress,
      t.walletAlias ?? '',
      t.walletStatus ?? '',
      t.action,
      t.tokenSymbol ?? t.tokenAddress,
      t.amountUsd.toFixed(2),
      t.tokenAgeHours !== null ? t.tokenAgeHours.toFixed(1) : '',
      t.marketCapUsd !== null ? t.marketCapUsd.toFixed(0) : '',
    ])

    await client.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${RESULTS_TAB}!A:I`,
      valueInputOption: 'RAW',
      requestBody: { values: rows },
    })

    return true
  } catch (err) {
    console.error('[smart-money-sync] Sheet write failed:', err instanceof Error ? err.message : String(err))
    return false
  }
}

// ── 5. Telegram alert ─────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Send a Telegram alert for alertable smart money trades.
 * Uses the sniper bot token + chat ID.
 */
export async function sendSmartMoneyAlerts(trades: SmartMoneyTrade[]): Promise<number> {
  if (trades.length === 0) return 0

  const token = process.env.SNIPER_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || ''
  const chatId = process.env.SNIPER_TELEGRAM_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID || ''
  if (!token || !chatId) return 0

  let sent = 0
  for (const t of trades) {
    const ageStr = t.tokenAgeHours !== null
      ? `${t.tokenAgeHours.toFixed(1)}h`
      : 'unknown'
    const mcStr = t.marketCapUsd !== null
      ? `$${(t.marketCapUsd / 1000).toFixed(0)}K`
      : 'unknown'
    const alias = t.walletAlias ? escapeHtml(t.walletAlias) : `${t.walletAddress.slice(0, 8)}…`
    const status = escapeHtml(t.walletStatus ?? 'CLASSIFIED')
    const tokenName = escapeHtml(t.tokenSymbol ?? t.tokenAddress.slice(0, 8))
    const actionEmoji = t.action === 'BUY' ? '🟢' : '🔴'
    const text = [
      `🧠 <b>SMART MONEY ALERT</b>`,
      ``,
      `${actionEmoji} <b>${escapeHtml(t.action)}</b> · ${tokenName}`,
      `💰 Amount: <b>$${t.amountUsd.toFixed(0)}</b>`,
      `⏱ Token age: <b>${ageStr}</b>`,
      `📊 Market cap: <b>${mcStr}</b>`,
      ``,
      `👤 Wallet: <code>${t.walletAddress}</code>`,
      `   Alias: ${alias} (${status})`,
      `⛓ Chain: ${escapeHtml(t.chain)}`,
      ``,
      `🕐 ${t.timestamp.toISOString().slice(0, 19)}Z`,
    ].join('\n')

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      })
      if (res.ok) sent++
      else {
        const body = await res.text().catch(() => '')
        console.error(`[smart-money-sync] Telegram send failed: ${res.status} ${body.slice(0, 200)}`)
      }
    } catch (err) {
      console.error('[smart-money-sync] Telegram error:', err instanceof Error ? err.message : String(err))
    }
  }
  return sent
}

// ── 6. Full pipeline (cron entrypoint) ────────────────────────

export interface SmartMoneySyncResult {
  walletsSynced: number
  newWallets: number
  tradesFound: number
  alertableTrades: number
  alertsSent: number
  sheetWritten: boolean
}

/**
 * Full pipeline: sync wallets from sheet → query activity → filter →
 * write results to sheet → send Telegram alerts.
 */
export async function runSmartMoneySync(): Promise<SmartMoneySyncResult> {
  // 1. Sync wallets from the operator's Google Sheet
  const sync = await syncWalletsFromSheet()

  // 2. Query recent smart money activity (last 1h)
  const trades = await querySmartMoneyActivity(1)

  // 3. Filter trades matching alert criteria
  const alertable = filterAlertableTrades(trades)

  // 4. Write ALL recent trades to the results sheet (audit trail)
  const sheetWritten = await writeResultsToSheet(trades)

  // 5. Send Telegram alerts for alertable trades only
  const alertsSent = await sendSmartMoneyAlerts(alertable)

  const result: SmartMoneySyncResult = {
    walletsSynced: sync.synced,
    newWallets: sync.newWallets,
    tradesFound: trades.length,
    alertableTrades: alertable.length,
    alertsSent,
    sheetWritten,
  }

  console.log('[smart-money-sync]', JSON.stringify(result))
  return result
}
