// ─────────────────────────────────────────────────────────────
// Meme Sniper — audit backtest (READ-ONLY analytics).
//
// Measures whether the engine's gates/predictors correlate with forward
// price moves, using only persisted data + the public Jupiter price API.
//
// Reads  : data/sniper-audit.json (append-only trail) and, for profile
//          breach labels, data/sniper-log.json (scan ring buffer).
// Writes : data/audit-backtest-report.json only (gitignored). Never
//          mutates data/*.json.
// Exit   : 0 on success/empty/unpriceable; 1 only when the audit file
//          itself cannot be read (e.g. permission denied).
//
// Env:
//   BACKTEST_MAX_CONTRACTS — cap of unique contracts priced (default 30)
//   SNIPER_AUDIT_PATH      — override audit path (honours the shared module)
//   SNIPER_LOG_PATH        — override scan-log path
// ─────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import type { AuditEntry } from '@/lib/modules/derived/sniper-audit'
import {
  buildBacktestRow,
  summariseBacktest,
  type BacktestDistribution,
  type BacktestRow,
  type BacktestRowInput,
  type BacktestSummary,
} from '@/lib/modules/derived/audit-backtest'
import { JUP_PRICE_URL } from '@/lib/modules/derived/solana-harvest'

const AUDIT_PATH = process.env.SNIPER_AUDIT_PATH ?? join(process.cwd(), 'data', 'sniper-audit.json')
const LOG_PATH = process.env.SNIPER_LOG_PATH ?? join(process.cwd(), 'data', 'sniper-log.json')
const REPORT_PATH = join(process.cwd(), 'data', 'audit-backtest-report.json')
const FETCH_DELAY_MS = 150
const FETCH_TIMEOUT_MS = 8_000

interface SniperLogEntry {
  contract?: unknown
  rejections?: unknown
}

function maxContracts(): number {
  const raw = process.env.BACKTEST_MAX_CONTRACTS
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Read the audit trail for the script. Missing/corrupt reads as empty and
 * exits 0 (matching the shared module's never-throw contract). Only a real
 * read failure (EACCES, EISDIR, …) is fatal.
 */
function readAuditEntries(): { entries: AuditEntry[]; fatal: string | null } {
  if (!existsSync(AUDIT_PATH)) return { entries: [], fatal: null }
  let raw: string
  try {
    raw = readFileSync(AUDIT_PATH, 'utf8')
  } catch (e) {
    return { entries: [], fatal: `cannot read audit file ${AUDIT_PATH}: ${errorMessage(e)}` }
  }
  try {
    const parsed = JSON.parse(raw) as { entries?: AuditEntry[] }
    if (!Array.isArray(parsed.entries)) return { entries: [], fatal: null }
    return { entries: parsed.entries, fatal: null }
  } catch {
    return { entries: [], fatal: null }
  }
}

/** Latest (newest-first) rejections per contract from the scan ring buffer. */
function readRejectionsByContract(): Map<string, string[]> {
  const map = new Map<string, string[]>()
  if (!existsSync(LOG_PATH)) return map
  try {
    const parsed = JSON.parse(readFileSync(LOG_PATH, 'utf8')) as { entries?: SniperLogEntry[] }
    if (!Array.isArray(parsed.entries)) return map
    for (const entry of parsed.entries) {
      const contract = entry?.contract
      if (typeof contract !== 'string' || contract.length === 0) continue
      if (map.has(contract)) continue
      map.set(contract, Array.isArray(entry.rejections) ? entry.rejections.filter((r): r is string => typeof r === 'string') : [])
    }
  } catch {
    // ring buffer unreadable → profile analysis just stays empty
  }
  return map
}

/**
 * Newest entry per contract, then OLDEST evaluations first so long-horizon
 * tokens have real forward data. Entries are newest-first on disk, so the
 * first occurrence wins.
 */
function selectContracts(entries: AuditEntry[], cap: number): AuditEntry[] {
  const newestByContract = new Map<string, AuditEntry>()
  for (const entry of entries) {
    if (typeof entry?.contract !== 'string' || entry.contract.length === 0) continue
    if (!newestByContract.has(entry.contract)) newestByContract.set(entry.contract, entry)
  }
  return [...newestByContract.values()]
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(0, cap)
}

/** Jupiter current price, exactly the meme-price-observer pattern. */
async function fetchTokenUsd(contract: string): Promise<number | null> {
  const res = await fetch(`${JUP_PRICE_URL}?ids=${encodeURIComponent(contract)}`, {
    headers: { 'User-Agent': 'nexus/1.0' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Jupiter HTTP ${res.status}`)
  const json = (await res.json()) as Record<string, { usdPrice?: unknown }>
  const price = json[contract]?.usdPrice
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null
  return price
}

function distributionOf(entry: AuditEntry): BacktestDistribution | null {
  const d = entry.distribution
  if (!d) return null
  return {
    devPercent: typeof d.devPercent === 'number' ? d.devPercent : null,
    sniperPercent: typeof d.sniperPercent === 'number' ? d.sniperPercent : null,
    bundlerPercent: typeof d.bundlerPercent === 'number' ? d.bundlerPercent : null,
    insiderPercent: typeof d.insiderPercent === 'number' ? d.insiderPercent : null,
    top10Percent: typeof d.top10Percent === 'number' ? d.top10Percent : null,
    clusterPercent: typeof d.clusterPercent === 'number' ? d.clusterPercent : null,
  }
}

function fmtRate(r: number | null): string {
  return r === null ? 'n/a' : `${(r * 100).toFixed(1)}%`
}

function fmtPct(r: number | null): string {
  return r === null ? 'n/a' : `${r >= 0 ? '+' : ''}${r.toFixed(1)}%`
}

function compactLines(rows: BacktestRow[], summary: BacktestSummary): string[] {
  const lines: string[] = [
    `[audit-backtest] evaluated=${summary.totalEvaluated} priced=${summary.totalPriced} winRate=${fmtRate(summary.winRate)} stopRate=${fmtRate(summary.stopRate)} flatRate=${fmtRate(summary.flatRate)} avgReturn=${fmtPct(summary.avgReturnPct)}`,
  ]
  const statusKeys = Object.keys(summary.byStatus)
  if (statusKeys.length > 0) {
    lines.push(
      `[audit-backtest] status ${statusKeys
        .map((k) => `${k}:${summary.byStatus[k].priced}/${summary.byStatus[k].count} target=${fmtRate(summary.byStatus[k].targetRate)}`)
        .join(' ')}`,
    )
  }
  const rejectionKeys = Object.keys(summary.byRejectionCount)
  lines.push(
    `[audit-backtest] rejectionCount ${rejectionKeys
      .map((k) => `${k}:${summary.byRejectionCount[k].priced}/${summary.byRejectionCount[k].count} target=${fmtRate(summary.byRejectionCount[k].targetRate)} stop=${fmtRate(summary.byRejectionCount[k].stopRate)}`)
      .join(' ')}`,
  )
  const profileKeys = Object.keys(summary.byProfile)
  if (profileKeys.length > 0) {
    lines.push(
      `[audit-backtest] profile ${profileKeys
        .map((k) => `${k}:${summary.byProfile[k].priced}/${summary.byProfile[k].count} target=${fmtRate(summary.byProfile[k].targetRate)} stop=${fmtRate(summary.byProfile[k].stopRate)}`)
        .join(' ')}`,
    )
  }
  for (const row of rows) {
    lines.push(
      `[audit-backtest] ${row.contract} status=${row.status} rej=${row.rejectionCount} entry=${row.entryMarketCapUsd.toFixed(2)} return=${fmtPct(row.returnPct)} outcome=${row.outcome ?? 'UNPRICED'}`,
    )
  }
  return lines
}

async function main(): Promise<void> {
  const { entries, fatal } = readAuditEntries()
  if (fatal !== null) {
    console.error(`[audit-backtest] ${fatal}`)
    process.exit(1)
  }

  const auditEntries = entries.filter(
    (e) => typeof e?.contract === 'string' && e.contract.length > 0,
  )

  if (auditEntries.length === 0) {
    console.log('[audit-backtest] audit file missing, corrupt, or empty — nothing to evaluate (exit 0)')
    return
  }

  const selected = selectContracts(auditEntries, maxContracts())
  const rejectionsByContract = readRejectionsByContract()

  const inputs: BacktestRowInput[] = []
  for (const entry of selected) {
    if (entry.marketCapUsd === null || !Number.isFinite(entry.marketCapUsd) || entry.marketCapUsd <= 0) {
      console.log(`[audit-backtest] skip ${entry.contract}: null/unproven entry market cap`)
      continue
    }
    inputs.push({
      contract: entry.contract,
      at: entry.at,
      status: entry.status,
      tier: entry.tier,
      rejectionCount: entry.rejectionCount,
      entryMarketCapUsd: entry.marketCapUsd,
      distribution: distributionOf(entry),
      rejections: rejectionsByContract.get(entry.contract) ?? [],
    })
  }

  const rows: BacktestRow[] = []
  let fetchFailures = 0
  let first = true
  for (const input of inputs) {
    if (!first) await sleep(FETCH_DELAY_MS)
    first = false
    let price: number | null = null
    try {
      price = await fetchTokenUsd(input.contract)
    } catch (e) {
      fetchFailures += 1
      console.error(`[audit-backtest] skip ${input.contract}: ${errorMessage(e)}`)
    }
    rows.push(buildBacktestRow(input, price))
  }

  const summary = summariseBacktest(rows)
  const report = {
    generatedAt: new Date().toISOString(),
    sourceAudit: AUDIT_PATH,
    sourceLog: LOG_PATH,
    maxContracts: maxContracts(),
    uniqueContractsSeen: selectContracts(auditEntries, Number.POSITIVE_INFINITY).length,
    evaluated: summary.totalEvaluated,
    priced: summary.totalPriced,
    fetchFailures,
    summary,
    rows,
  }

  mkdirSync(dirname(REPORT_PATH), { recursive: true })
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  for (const line of compactLines(rows, summary)) console.log(line)
  console.log(`[audit-backtest] wrote ${REPORT_PATH} fetchFailures=${fetchFailures}`)
}

void main()
