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

import { prisma } from '@/lib/db'

/** The operator's spreadsheet ID (from the shared link). */
export const SPREADSHEET_ID = '14Kr-P8-DByM-jAw4ydo2x29YAp_LPc9uivHMidP6-78'

/** Sheet tab names. */
const WALLET_SOURCE_TAB = process.env.SMART_MONEY_WALLET_TAB || 'Sheet1'
const RESULTS_TAB = process.env.SMART_MONEY_RESULTS_TAB || 'SmartMoneyActivity'

/** Alert thresholds (operator-specified). */
export const ALERT_THRESHOLDS = {
  maxTokenAgeHours: 24,
  minAmountUsd: 1000,
  maxMarketCapUsd: 1_000_000,
} as const

// ── Google Sheets auth via gog CLI ────────────────────────────
//
// gog CLI (v0.34+) stores OAuth tokens for Google services. We use it
// as the credential provider:
//   - Read: `gog sheets get -j -a <account> <id> <range>` (subprocess)
//   - Write: extract access token from gog, use googleapis REST client
//
// gog v0.34 only ships `sheets get` (read). For writes, we extract the
// OAuth2 access token gog internally manages and pass it to the
// googleapis client. The token auto-refreshes via gog's stored refresh
// token on each invocation.
//
// Env:
//   GOG_ACCOUNT          — Google account email (default: moliangellina@gmail.com)
//   GOG_KEYRING_PASSWORD — gog keyring decryption password
//
// Falls back to public CSV export for reads if gog is unavailable.
// Falls back to skipping writes if gog token extraction fails.

const GOG_ACCOUNT = process.env.GOG_ACCOUNT || 'moliangellina@gmail.com'

/** gog binary path (checked once, cached). */
let gogPath: string | null | undefined

function getGogPath(): string | null {
  if (gogPath !== undefined) return gogPath
  try {
    const { execSync } = require('node:child_process') as typeof import('node:child_process')
    const result = execSync('which gog 2>/dev/null || echo ""', { encoding: 'utf8', timeout: 3000 }).trim()
    gogPath = result || null
  } catch {
    gogPath = null
  }
  return gogPath
}

/** gog keyring password (required to decrypt OAuth tokens). */
function getGogKeyringPassword(): string | null {
  return process.env.GOG_KEYRING_PASSWORD || process.env.GMAIL_KEYRING_PASSWORD || null
}

/**
 * Extract a fresh OAuth2 access token from gog's encrypted keyring.
 *
 * Flow:
 *   1. Decrypt the JWE-encrypted keyring file (PBES2-HS256+A128KW + A256GCM)
 *      using the keyring password — via Python subprocess (cryptography lib).
 *   2. Extract the refresh_token from the decrypted keyring Data field.
 *   3. Exchange the refresh_token for an access_token via Google's OAuth
 *      endpoint using the gog client credentials.
 *   4. Cache the access_token for 50 minutes (Google tokens expire in ~1h).
 *
 * Returns the access token string, or null if unavailable.
 */
let cachedAccessToken: { token: string; expiresAt: number } | null = null

const GOG_KEYRING_DECRYPT_SCRIPT = `import base64, json, hashlib, sys
from pathlib import Path

password = sys.argv[1].encode()
keyring_file = sys.argv[2]

raw = Path(keyring_file).read_text()
parts = raw.split('.')
header = json.loads(base64.urlsafe_b64decode(parts[0] + '=='))
alg = header['alg']
p2s_raw = base64.urlsafe_b64decode(header['p2s'] + '==')
salt = alg.encode() + b'\\x00' + p2s_raw
kw_key = hashlib.pbkdf2_hmac('sha256', password, salt, header['p2c'], dklen=16)

enc_key = base64.urlsafe_b64decode(parts[1] + '==')
iv = base64.urlsafe_b64decode(parts[2] + '==')
ct = base64.urlsafe_b64decode(parts[3] + '==')
tag = base64.urlsafe_b64decode(parts[4] + '==')

from cryptography.hazmat.primitives.keywrap import aes_key_unwrap
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
cek = aes_key_unwrap(kw_key, enc_key)
plaintext = AESGCM(cek).decrypt(iv, ct + tag, parts[0].encode())
entry = json.loads(plaintext)
token_json = base64.b64decode(entry['Data']).decode()
token_data = json.loads(token_json)
sys.stdout.write(token_data.get('refresh_token', ''))
`

async function getGogAccessToken(): Promise<string | null> {
  // Cache token for 50 minutes
  if (cachedAccessToken && Date.now() < cachedAccessToken.expiresAt) {
    return cachedAccessToken.token
  }

  const gog = getGogPath()
  if (!gog) return null
  const keyringPw = getGogKeyringPassword()
  if (!keyringPw) return null

  const gogHome = process.env.GOG_HOME || `${process.env.HOME}/.config/gogcli`
  const keyringFile = `${gogHome}/keyring/token:${GOG_ACCOUNT}`

  try {
    // Step 1: Decrypt keyring → get refresh token
    const { execSync } = require('node:child_process') as typeof import('node:child_process')
    const fs = require('node:fs') as typeof import('node:fs')
    const os = require('node:os') as typeof import('node:os')
    const path = require('node:path') as typeof import('node:path')

    // Write decrypt script to temp file (avoids shell escaping issues with -c)
    const scriptPath = path.join(os.tmpdir(), 'gog-keyring-decrypt.py')
    fs.writeFileSync(scriptPath, GOG_KEYRING_DECRYPT_SCRIPT, { mode: 0o600 })

    const refreshToken = execSync(
      `python3 "${scriptPath}" "${keyringPw}" "${keyringFile}"`,
      { encoding: 'utf8', timeout: 10000 },
    ).trim()

    if (!refreshToken) {
      console.error('[smart-money-sync] No refresh_token in gog keyring')
      return null
    }

    // Step 2: Read gog client credentials
    const credsPath = `${gogHome}/credentials.json`
    if (!fs.existsSync(credsPath)) {
      console.error('[smart-money-sync] gog credentials.json not found')
      return null
    }
    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8')) as {
      client_id: string
      client_secret: string
    }

    // Step 3: Exchange refresh token for access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: creds.client_id,
        client_secret: creds.client_secret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    })

    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => '')
      console.error(`[smart-money-sync] Token exchange failed (${tokenRes.status}): ${errText}`)
      return null
    }

    const tokenData = await tokenRes.json() as {
      access_token: string
      expires_in: number
    }

    cachedAccessToken = {
      token: tokenData.access_token,
      expiresAt: Date.now() + (tokenData.expires_in - 60) * 1000,
    }
    return tokenData.access_token
  } catch (err) {
    console.error('[smart-money-sync] gog token extraction failed:', err instanceof Error ? err.message : String(err))
    return null
  }
}

/**
 * Build an authenticated Google Sheets REST API helper using the gog
 * OAuth token. Returns null if gog token extraction fails.
 *
 * Uses direct fetch() to the Sheets v4 REST endpoints with
 * `Authorization: Bearer <token>` — no googleapis client needed.
 */
interface SheetsApi {
  get(range: string): Promise<string[][]>
  append(range: string, values: unknown[][]): Promise<boolean>
  update(range: string, values: unknown[][]): Promise<boolean>
  batchUpdate(requests: unknown[]): Promise<boolean>
}

let cachedSheetsApi: SheetsApi | null | undefined

async function getSheetsApi(): Promise<SheetsApi | null> {
  if (cachedSheetsApi !== undefined) return cachedSheetsApi
  const token = await getGogAccessToken()
  if (!token) {
    cachedSheetsApi = null
    return null
  }
  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  cachedSheetsApi = {
    async get(range: string): Promise<string[][]> {
      const res = await fetch(`${baseUrl}/values/${encodeURIComponent(range)}`, { headers })
      if (!res.ok) throw new Error(`Sheets GET ${res.status}: ${await res.text().catch(() => '')}`)
      const data = await res.json() as { values?: string[][] }
      return data.values ?? []
    },
    async append(range: string, values: unknown[][]): Promise<boolean> {
      const res = await fetch(
        `${baseUrl}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        { method: 'POST', headers, body: JSON.stringify({ values }) },
      )
      return res.ok
    },
    async update(range: string, values: unknown[][]): Promise<boolean> {
      const res = await fetch(
        `${baseUrl}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
        { method: 'PUT', headers, body: JSON.stringify({ values }) },
      )
      return res.ok
    },
    async batchUpdate(requests: unknown[]): Promise<boolean> {
      const res = await fetch(`${baseUrl}:batchUpdate`, {
        method: 'POST', headers, body: JSON.stringify({ requests }),
      })
      return res.ok
    },
  }
  return cachedSheetsApi
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

  // ── Fallback: authenticated Sheets API via gog ──
  const api = await getSheetsApi()
  if (!api) return []
  try {
    const rows = await api.get(`${WALLET_SOURCE_TAB}!A:B`)
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

  // Count existing wallets to determine true new inserts
  const existingAddresses = new Set(
    (await prisma.wallet.findMany({
      where: { address: { in: sheetWallets.map((w) => w.address) } },
      select: { address: true },
    })).map((w) => w.address),
  )

  let newWallets = 0
  for (const w of sheetWallets) {
    const existed = existingAddresses.has(w.address)
    await prisma.wallet.upsert({
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
    })
    if (!existed) newWallets++
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
  const api = await getSheetsApi()
  if (!api) return false

  try {
    // Ensure the results tab exists (ignore error if already exists)
    await api.batchUpdate([{ addSheet: { properties: { title: RESULTS_TAB } } }])

    // Write header if empty
    const header = await api.get(`${RESULTS_TAB}!A1:I1`).catch(() => [] as string[][])
    if (header.length === 0) {
      await api.update(`${RESULTS_TAB}!A1:I1`, [[
        'Timestamp', 'Wallet', 'Alias', 'Status',
        'Action', 'Token', 'Amount USD', 'Token Age (h)', 'Market Cap USD',
      ]])
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

    await api.append(`${RESULTS_TAB}!A:I`, rows)

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
