// ─────────────────────────────────────────────────────────────
// Sniper scan — core scan runner: audit fan-out, evaluate, deliver.
// Carved verbatim from sniper-scan.ts for the 800-line gate.
// ─────────────────────────────────────────────────────────────

import {
  evaluateSniper,
  deliverSniperAlert,
  type SniperDecision,
} from '@/lib/modules/derived/meme-sniper'
import {
  toSniperPayload,
  type SniperEnrichedToken,
} from '@/lib/modules/derived/sniper-source'
import type { MemeRiskAudit } from '@/lib/modules/meme/types'
import { traceTokenBuyers } from '@/lib/modules/derived/wallet-tracer'
import {
  getSmartMoneyEvidence,
  evaluateSmartMoneyGate,
  type SmartMoneyEvidence,
} from '@/lib/modules/derived/smart-money-provider'
import {
  classifySignalTier,
  shouldDeliver,
  formatTieredSignal,
  DEFAULT_DELIVERY_POLICY,
  type SignalTier,
  type DeliveryPolicy,
  type ContractButtons,
} from '@/lib/modules/derived/signal-tier'
import {
  candidateKey,
  resolveCategory,
  type CandidateEvidence,
  type DiscoveryCategory,
} from '@/lib/modules/derived/unified-candidate'
import {
  collapseDuplicateCandidatesByTrust,
  normalizeTickerForDedup,
} from '@/lib/modules/derived/candidate-trust'
import { profilesForPhase } from '@/lib/modules/derived/sniper-criteria'
import { toSniperGate, assessDevHistory, type DevHistoryVerdict } from '@/lib/modules/derived/dev-history'
import { fetchDevTokenHistory } from '@/lib/modules/meme/solpump/dev-tokens'
import { auditRugcheckToken } from '@/lib/modules/meme/rugcheck'
import { auditBirdeyeToken } from '@/lib/modules/meme/birdeye'
import { auditGmgnToken } from '@/lib/modules/meme/gmgn'
import {
  isScanSeen as isScanSeenDb,
  isTickerSeen as isTickerSeenDb,
} from '@/lib/modules/derived/db-seen-store'
import { saveScanDecisions, saveAuditEntries } from '@/lib/modules/derived/db-stores'
import { buildAuditEntries } from '@/lib/modules/derived/sniper-audit'
// Sibling imports (carved split — dependency flows: seen ← discover ← core)
import { readSeenState, markSeenState, tickerSeenUnderDifferentContract, trackScanSeen, trackTickerSeen } from './sniper-scan-seen'
import { discoverCombined } from './sniper-scan-discover'

const STALE_AFTER_MINUTES = Number(process.env.SNIPER_STALE_AFTER_MINUTES) || 120

/** Per-contract audit fan-out — every source isolated. */
export async function collectAudits(chain: string, contract: string): Promise<MemeRiskAudit[]> {
  const results = await Promise.allSettled([
    auditRugcheckToken(chain, contract),
    auditBirdeyeToken(chain, contract),
    auditGmgnToken(chain, contract),
  ])
  return results
    .filter((r): r is PromiseFulfilledResult<MemeRiskAudit | null> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((a): a is MemeRiskAudit => a !== null)
}

export interface SniperScanDeps {
  discover: (limit: number) => Promise<SniperEnrichedToken[]>
  audit: (chain: string, contract: string) => Promise<MemeRiskAudit[]>
  deliver: (text: string, replyMarkup?: ContractButtons) => Promise<boolean>
  /**
   * Wallet-DB smart-money evidence. Injectable so tests stay offline;
   * when omitted the scan runs without wallet confirmation (verdicts cap
   * at WATCHLIST via the evaluator's absent-evidence rule).
   */
  smartMoney?: (chain: string, contract: string) => Promise<SmartMoneyEvidence>
  /**
   * Developer deploy-history classifier (anti-rug). Injectable so tests
   * stay offline; the default assesses via the solpump dev-tokens
   * endpoint. Consulted only when SNIPER_DEV_HISTORY_GATE=true.
   */
  devHistory?: (chain: string, contract: string) => Promise<DevHistoryVerdict>
}

// ─── Dev-history gate (anti-rug, opt-in) ────────────────────────
// SNIPER_DEV_HISTORY_GATE="true" turns the gate on; default OFF keeps the
// existing pipeline byte-for-byte. The lookup (solpump dev-tokens endpoint)
// is expensive per candidate, so verdicts are memoized per CONTRACT for 30
// min (max 500 entries, oldest evicted). Per-contract is the correctness-
// safe key (a verdict describes one token, not its dev); the trade-off is
// that different contracts from the same dev still fetch separately. And
// because cron spawns a fresh process every pass, the 30-min TTL is
// effectively per-pass — it only dedupes repeated candidates within one scan.

const DEV_HISTORY_TTL_MS = 30 * 60_000
const DEV_HISTORY_MAX_ENTRIES = 500
const devHistoryMemo = new Map<string, { verdict: DevHistoryVerdict; at: number }>()

/** Test hook: clear the in-memory dev-history memo cache. */
export function __resetDevHistoryMemoForTests(): void {
  devHistoryMemo.clear()
}

function devHistoryGateEnabled(): boolean {
  return process.env.SNIPER_DEV_HISTORY_GATE === 'true'
}

/**
 * Memoized verdict for the candidate's contract. Failure payloads
 * ({ devAddress: null, tokens: [] }) are cached too — an endpoint outage
 * must not multiply into one fetch per candidate per pass.
 */
async function memoizedDevHistory(
  chain: string,
  contract: string,
  fetcher: (chain: string, contract: string) => Promise<DevHistoryVerdict>,
): Promise<DevHistoryVerdict> {
  const key = `${chain}:${contract}`
  const hit = devHistoryMemo.get(key)
  if (hit && Date.now() - hit.at < DEV_HISTORY_TTL_MS) return hit.verdict
  const verdict = await fetcher(chain, contract)
  if (devHistoryMemo.size >= DEV_HISTORY_MAX_ENTRIES) {
    // Map preserves insertion order — the first key is the oldest entry.
    const oldest = devHistoryMemo.keys().next().value
    if (oldest !== undefined) devHistoryMemo.delete(oldest)
  }
  devHistoryMemo.set(key, { verdict, at: Date.now() })
  return verdict
}

/** Live dep: classify via the solpump dev-tokens adapter (pure judge). */
async function liveDevHistory(chain: string, contract: string): Promise<DevHistoryVerdict> {
  const input = await fetchDevTokenHistory(chain, contract)
  return assessDevHistory(input)
}

/** No-wallet-evidence shape: empty, never a fabricated bullish row. */
function EMPTY_SMART_MONEY(chain: string, contract: string): SmartMoneyEvidence {
  return {
    contract,
    chain,
    buyers: [],
    walletsHolding: 0,
    byStatus: {},
    strongest: null,
    bullishHoldingUsd: null,
    ttlMs: 0,
    source: 'none',
  }
}

/**
 * Wallet evidence for a candidate.
 *
 * The DB path (getSmartMoneyEvidence) only knows tokens already ingested —
 * for a freshly-created mint that is almost always nothing, which caps
 * every candidate at WATCHLIST. When the DB returns no evidence we trace
 * the token's on-chain top holders instead (wallet-tracer), which is what
 * turns "no wallets known" into real classification evidence.
 *
 * `SNIPER_TRACE_WALLETS=false` disables the on-chain trace (DB only).
 */
async function liveSmartMoney(chain: string, contract: string): Promise<SmartMoneyEvidence> {
  const fromDb = await getSmartMoneyEvidence(contract, chain)
  if (fromDb.buyers.length > 0) return fromDb
  if ((process.env.SNIPER_TRACE_WALLETS ?? 'true') === 'false') return fromDb
  try {
    return await traceTokenBuyers(contract, chain)
  } catch {
    return fromDb
  }
}

const LIVE_DEPS: SniperScanDeps = {
  discover: discoverCombined,
  audit: collectAudits,
  deliver: (text: string, replyMarkup?: ContractButtons) => deliverSniperAlert(text, undefined, replyMarkup),
  smartMoney: liveSmartMoney,
  devHistory: liveDevHistory,
}

export interface SniperScanDecision extends SniperDecision {
  contract: string
  ticker: string
  /** True when evaluated within the seen-TTL — evaluated, not re-sent. */
  deduped: boolean
  delivered: boolean
  auditsUsed: string[]
  /** Operator quality tier (policy D). Only HIGH_CONVICTION is a top signal. */
  tier: SignalTier
  tierReasons: string[]
  tierMissing: string[]
  /** Classified wallet buyers backing this token (evidence, with provenance). */
  smartMoneyBuyers: number
  smartMoneyStrongest: string | null
  smartMoneySource: string
  /** How this candidate entered the funnel (MULTI_SOURCE when >1 provider). */
  discoveryCategory: DiscoveryCategory
  /** Every source that reported this token, newest first. */
  discoveryEvidence: CandidateEvidence[]
  /**
   * Market snapshot at evaluation time. Null when the discovery row never
   * proved the number — REVIEW shows UNKNOWN, never a fabricated 0.
   */
  market: {
    marketCapUsd: number | null
    liquidityUsd: number | null
    volume5mUsd: number | null
    priceUsd: number | null
  }
  /**
   * Holder distribution at evaluation time. Feeds the accumulation phase
   * (holder-tier delta across scans) via the audit trail. null = unproven.
   * Optional because older evaluations persisted before this field existed.
   */
  distribution?: {
    devPercent: number | null
    sniperPercent: number | null
    bundlerPercent: number | null
    /** Launch-cohort exit ratio (0..100). null = the rate was not reported. */
    bundlerSoldPercent?: number | null
    insiderPercent: number | null
    top10Percent: number | null
    clusterPercent: number | null
  }
}

export interface SniperScanResult {
  scanned: number
  screened: number
  watchlisted: number
  rejected: number
  /** Of `rejected`: rows the audit fan-out actually judged vs aborted pre-audit. */
  rejectAudited: number
  rejectPreGate: number
  deduped: number
  delivered: number
  decisions: SniperScanDecision[]
  errors: string[]
  /** Candidates per discovery category — proves coverage per pass. */
  categories: Record<string, number>
}

/**
 * One scan pass: discover → audit → evaluate → (optionally) deliver.
 *
 * `persist` writes this pass to the DB-primary stores (scan decisions +
 * audit trail). It is opt-in so the pure scan stays testable and so callers
 * that need the pre-persist audit comparison (sniper-cron's materiallyChanged)
 * keep full control of ordering.
 */
export async function runSniperScan(
  opts: { limit?: number; deliver?: boolean; deliveryPolicy?: DeliveryPolicy; persist?: boolean } = {},
  deps: SniperScanDeps = LIVE_DEPS,
): Promise<SniperScanResult> {
  const limit = Math.min(Math.max(opts.limit ?? 3, 1), 10)
  const errors: string[] = []
  let candidates: SniperEnrichedToken[] = []
  try {
    const discoverFn = deps?.discover ?? LIVE_DEPS.discover
    candidates = await discoverFn(limit)
  } catch (err) {
    errors.push(`discovery: ${err instanceof Error ? err.message : String(err)}`)
  }

  const seen = readSeenState()

  // Trust-ranking dedup: when multiple mints share the same normalized
  // ticker (copycats / re-launches), keep only the single most-trusted
  // one and drop the rest BEFORE audit/evaluation so the pipeline never
  // wastes an audit pass or a delivery slot on a less-trusted duplicate.
  // Dropped copycats are marked seen so they don't re-enter next pass.
  const collapse = collapseDuplicateCandidatesByTrust(candidates)
  candidates = collapse.kept
  if (collapse.dropped.length > 0) {
    const dupTickers = new Set(
      collapse.dropped.map((d) => normalizeTickerForDedup(d.candidate.symbol)),
    )
    console.log(
      `[sniper] ticker dedup: dropped ${collapse.dropped.length} copycat mints across ${dupTickers.size} duplicate tickers`,
    )
    for (const d of collapse.dropped) {
      await trackScanSeen(seen, d.candidate.chain, d.candidate.contract)
    }
  }

  const decisions: SniperScanDecision[] = []
  let delivered = 0

  for (const token of candidates) {
    try {
      // Anti-rug pre-gate (opt-in): a dev with a proven serial-rugger/
      // suspect deploy history is rejected BEFORE the audit fan-out, so
      // three upstream API calls are never spent on a doomed candidate.
      // UNPROVEN passes — a brand-new dev is unjudged, not guilty; the
      // security/momentum gates still judge the token itself.
      let devHistoryRejection: string | null = null
      if (devHistoryGateEnabled() && deps.devHistory) {
        const verdict = await memoizedDevHistory(token.chain, token.contract, deps.devHistory)
        const gate = toSniperGate(verdict)
        if (!gate.ok) {
          devHistoryRejection = `[dev-history] ${gate.rejection}: ${verdict.reasons[0]}`
        }
      }
      if (devHistoryRejection) {
        decisions.push({
          status: 'REJECT',
          rationale: devHistoryRejection,
          rejections: [devHistoryRejection],
          warnings: [],
          metrics: { volMcRatio: null, ageMinutes: 0, ageLabel: 'unknown', stage: 'new-pair', stageLabel: 'unknown', requiredRatio: 0, devPercent: null, sniperPercent: null, bundlerPercent: null, insiderPercent: null, top10Percent: null, clusterPercent: null, avgPnlPercent: null, pnlAssessment: 'neutral' },
          alert: '',
          contract: token.contract,
          ticker: token.symbol,
          deduped: false,
          delivered: false,
          auditsUsed: [],
          tier: 'REJECT',
          tierReasons: ['dev-history gate'],
          tierMissing: [],
          smartMoneyBuyers: 0,
          smartMoneyStrongest: null,
          smartMoneySource: 'none',
          discoveryCategory: resolveCategory(token.discoveryEvidence),
          discoveryEvidence: token.discoveryEvidence ?? [],
          market: {
            marketCapUsd: token.marketCap > 0 ? token.marketCap : null,
            liquidityUsd: token.liquidity > 0 ? token.liquidity : null,
            volume5mUsd: token.volume5m && token.volume5m > 0 ? token.volume5m : null,
            priceUsd: token.price > 0 ? token.price : null,
          },
        })
        console.log(`[sniper] dev-history reject: ${token.contract.slice(0, 8)} — ${devHistoryRejection}`)
        continue
      }
      const audits = await deps.audit(token.chain, token.contract)
      const { payload, warnings: identityWarnings, auditsAccepted } = toSniperPayload(token, audits)
      // Wallet-DB confirmation is evidence, never a substitute for security.
      const walletEvidence = deps.smartMoney
        ? await deps.smartMoney(token.chain, token.contract)
        : EMPTY_SMART_MONEY(token.chain, token.contract)
      const smartMoney = evaluateSmartMoneyGate(walletEvidence)
      // Operator ebook profiles, chosen by phase so every one of the five
      // actually runs in production (ebooks gate DIFFERENT phases: new-pair
      // vs post-bonding vs exposure window). One evaluator pass judges the
      // token against the whole applicable set: a hard reject from any
      // profile appends evidence, none can un-reject an inline breach, and
      // no profile is consulted twice.
      const decision = evaluateSniper(payload, {
        extraWarnings: identityWarnings,
        smartMoney,
        criteriaProfiles: profilesForPhase(payload.ageMinutes),
      })
      // Operator quality tier (policy D): the evaluator says "safe+moving",
      // the tier says "good enough to send as a TOP signal".
      const tierResult = classifySignalTier({
        decision,
        smartMoney: deps.smartMoney ? walletEvidence : null,
        ageMinutes: payload.ageMinutes,
        staleAfterMinutes: STALE_AFTER_MINUTES,
        dataComplete: true,
      })

      const key = candidateKey(token.chain, token.contract)
      const contractSeen =
        seen[key] !== undefined || (await isScanSeenDb(token.chain, token.contract))
      const normTicker = normalizeTickerForDedup(payload.ticker)
      const priorTickerSeen = tickerSeenUnderDifferentContract(
        seen,
        normTicker,
        token.chain,
        token.contract,
      )
      const priorTickerSeenDb =
        normTicker.length > 0 ? await isTickerSeenDb(token.chain, normTicker) : false
      const deduped = contractSeen || priorTickerSeen !== null || priorTickerSeenDb
      let wasDelivered = false
      // Only push deliverable tiers, and never re-push a seen contract or a
      // copycat sharing a ticker already delivered under another contract.
      const policy = opts.deliveryPolicy ?? DEFAULT_DELIVERY_POLICY
      if (!deduped && opts.deliver === true && shouldDeliver(tierResult.tier, policy)) {
        // Policy E: delivered signals use the full evidence format, not the
        // evaluator's short alert. Same facts, complete provenance.
        const formatted = formatTieredSignal({
          payload,
          tier: tierResult.tier,
          tierReasons: tierResult.reasons,
          tierMissing: tierResult.missing,
          smartMoney: deps.smartMoney ? walletEvidence : null,
          // Provenance: which independent audits actually agreed, so the
          // operator can weigh cross-confirmation instead of inferring it.
          auditSources: auditsAccepted.map((a) => a.platform),
          marketCapUsd: payload.momentum.marketCap,
        })
        wasDelivered = await deps.deliver(formatted.text, formatted.replyMarkup)
        if (wasDelivered) {
          delivered++
          await trackTickerSeen(seen, token.chain, normTicker)
        }
      }
      // Only a non-REJECT outcome is worth remembering. Marking a REJECT seen
      // pinned the contract for the whole seen-TTL, so a token that failed the
      // momentum gate at minute 3 was never re-evaluated when vol/mcap climbed
      // past the threshold (measured 2026-10-11: rejected calls later ran
      // +274%/+683%/+1383%). REJECT rows stay eligible; they are cheap to
      // re-audit and cached.
      if (decision.status !== 'REJECT') await trackScanSeen(seen, token.chain, token.contract)
      decisions.push({
        ...decision,
        contract: token.contract,
        ticker: payload.ticker,
        deduped,
        delivered: wasDelivered,
        auditsUsed: auditsAccepted.map((a) => a.platform),
        tier: tierResult.tier,
        tierReasons: tierResult.reasons,
        tierMissing: tierResult.missing,
        smartMoneyBuyers: walletEvidence.buyers.length,
        smartMoneyStrongest: walletEvidence.strongest,
        smartMoneySource: walletEvidence.source,
        discoveryCategory: resolveCategory(token.discoveryEvidence),
        discoveryEvidence: token.discoveryEvidence ?? [],
        market: {
          marketCapUsd: token.marketCap > 0 ? token.marketCap : null,
          liquidityUsd: token.liquidity > 0 ? token.liquidity : null,
          volume5mUsd: token.volume5m && token.volume5m > 0 ? token.volume5m : null,
          priceUsd: token.price > 0 ? token.price : null,
        },
        /**
         * Holder distribution as read by THIS evaluation. Persisted so the
         * audit trail can compute a real holder-tier delta across scans
         * (TAHAP 2) instead of re-reading the chain. null = the audit source
         * did not prove the number — never a zero.
         */
        distribution: {
          devPercent: payload.distribution.devPercent,
          sniperPercent: payload.distribution.sniperPercent,
          bundlerPercent: payload.distribution.bundlerPercent,
          insiderPercent: payload.distribution.insiderPercent,
          top10Percent: payload.distribution.top10Percent,
          bundlerSoldPercent: payload.distribution.bundlerSoldPercent ?? null,
          clusterPercent: payload.distribution.clusterPercent ?? null,
        },
      })
    } catch (err) {
      errors.push(`${token.contract.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  markSeenState(seen)
  const result: SniperScanResult = {
    scanned: candidates.length,
    screened: decisions.filter((d) => d.status === 'SIGNAL').length,
    watchlisted: decisions.filter((d) => d.status === 'WATCHLIST').length,
    rejected: decisions.filter((d) => d.status === 'REJECT').length,
    rejectAudited: decisions.filter((d) => d.status === 'REJECT' && d.auditsUsed.length > 0).length,
    rejectPreGate: decisions.filter((d) => d.status === 'REJECT' && d.auditsUsed.length === 0).length,
    deduped: decisions.filter((d) => d.deduped).length,
    delivered,
    decisions,
    errors,
    categories: decisions.reduce<Record<string, number>>((acc, d) => {
      acc[d.discoveryCategory] = (acc[d.discoveryCategory] ?? 0) + 1
      return acc
    }, {}),
  }

  // DB-primary persistence is opt-in. sniper-cron persists explicitly (it
  // needs the pre-persist audit comparison via materiallyChanged), so the
  // default remains a pure scan with no side effects.
  if (opts.persist === true) {
    try {
      await saveScanDecisions(result.decisions, result)
      await saveAuditEntries(buildAuditEntries({ decisions: result.decisions }))
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      result.errors.push(`persist failed: ${reason}`)
    }
  }
  return result
}
