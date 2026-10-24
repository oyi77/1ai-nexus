// ─────────────────────────────────────────────────────────────
// Strategy Backtest Engine — Replay candidate tokens against the
// operator's THREE entry strategies (Second Wave, Level Flip, Whale Comeback).
//
// Pure aggregation and metric reporting: accepts candidate records,
// evaluates strategy rules, tallies refusal histograms and hit distributions.
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'
import type { StrategyId, StrategyVerdict } from './strategy-evaluator'
import {
  evaluateStrategiesFor,
  type StrategyIntakeResult,
} from './strategy-intake'
import type { MarketRow } from './accumulation-markets'
import { EMPTY_CONFLUENCE } from './call-confluence'
export interface BacktestCandidate {
  contract: string
  symbol: string
  chain: string
  marketCapUsd: number | null
  liquidityUsd: number | null
  volume24hUsd: number | null
  firstSeen?: Date | null
}

export interface StrategyHit {
  contract: string
  symbol: string
  strategy: StrategyId
  confidence: number
  entryUsd: number | null
  stopUsd: number | null
  targetUsd: number | null
  rr: number | null
  guardSource: string | null
  confluenceGroups: string[]
}

export interface StrategyBacktestReport {
  totalReplayed: number
  firedCount: number
  refusedCount: number
  hitRatePct: number
  hitsByStrategy: Record<StrategyId, number>
  hits: StrategyHit[]
  refusalHistogram: Record<string, number>
  marketCapBuckets: {
    under1M: number
    band1M_2M: number
    band2M_6M: number
    band6M_8M: number
    band8M_15M: number
    band15M_45M: number
    above45M: number
    unmeasured: number
  }
  liquidityBuckets: {
    under10k: number
    band10k_50k: number
    band50k_100k: number
    above100k: number
    unmeasured: number
  }
  summaryMarkdown: string
}

export interface BacktestOptions {
  limit?: number
  source?: 'launch_token' | 'call_feed' | 'both'
  minLiquidityUsd?: number
  candidates?: BacktestCandidate[]
  fetchFn?: typeof fetch
}

export function categorizeMarketCap(mc: number | null): keyof StrategyBacktestReport['marketCapBuckets'] {
  if (mc === null || !Number.isFinite(mc) || mc <= 0) return 'unmeasured'
  if (mc < 1_000_000) return 'under1M'
  if (mc < 2_000_000) return 'band1M_2M'
  if (mc < 6_000_000) return 'band2M_6M'
  if (mc < 8_000_000) return 'band6M_8M'
  if (mc < 15_000_000) return 'band8M_15M'
  if (mc < 45_000_000) return 'band15M_45M'
  return 'above45M'
}

export function categorizeLiquidity(liq: number | null): keyof StrategyBacktestReport['liquidityBuckets'] {
  if (liq === null || !Number.isFinite(liq) || liq <= 0) return 'unmeasured'
  if (liq < 10_000) return 'under10k'
  if (liq < 50_000) return 'band10k_50k'
  if (liq < 100_000) return 'band50k_100k'
  return 'above100k'
}

export function tallyRefusals(
  refusals: string[],
  histogram: Record<string, number>,
): void {
  for (const r of refusals) {
    // refusals format: "Strategy — rule: detail"
    const ruleMatch = r.match(/—\s*([^:]+):/)
    const ruleName = ruleMatch ? ruleMatch[1].trim() : r.split(':')[0].trim()
    histogram[ruleName] = (histogram[ruleName] ?? 0) + 1
  }
}

export function compileBacktestReport(
  candidates: BacktestCandidate[],
  results: StrategyIntakeResult[],
): StrategyBacktestReport {
  const hitsByStrategy: Record<StrategyId, number> = {
    second_wave: 0,
    level_flip: 0,
    whale_comeback: 0,
  }
  const hits: StrategyHit[] = []
  const refusalHistogram: Record<string, number> = {}

  const marketCapBuckets: StrategyBacktestReport['marketCapBuckets'] = {
    under1M: 0,
    band1M_2M: 0,
    band2M_6M: 0,
    band6M_8M: 0,
    band8M_15M: 0,
    band15M_45M: 0,
    above45M: 0,
    unmeasured: 0,
  }

  const liquidityBuckets: StrategyBacktestReport['liquidityBuckets'] = {
    under10k: 0,
    band10k_50k: 0,
    band50k_100k: 0,
    above100k: 0,
    unmeasured: 0,
  }

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i]
    const res = results[i]

    marketCapBuckets[categorizeMarketCap(cand.marketCapUsd)]++
    liquidityBuckets[categorizeLiquidity(cand.liquidityUsd)]++

    if (res && res.fired) {
      hitsByStrategy[res.fired.strategy]++
      hits.push({
        contract: cand.contract,
        symbol: cand.symbol,
        strategy: res.fired.strategy,
        confidence: res.fired.confidence,
        entryUsd: res.fired.entryUsd,
        stopUsd: res.fired.stopUsd,
        targetUsd: res.fired.targetUsd,
        rr: res.fired.rr,
        guardSource: res.guardSource,
        confluenceGroups: res.confluence.available ? res.confluence.groups : [],
      })
    } else if (res) {
      tallyRefusals(res.refusals, refusalHistogram)
    }
  }

  const total = candidates.length
  const firedCount = hits.length
  const refusedCount = total - firedCount
  const hitRatePct = total > 0 ? (firedCount / total) * 100 : 0

  const summaryMarkdown = formatSummaryMarkdown({
    total,
    firedCount,
    refusedCount,
    hitRatePct,
    hitsByStrategy,
    refusalHistogram,
    marketCapBuckets,
    liquidityBuckets,
  })

  return {
    totalReplayed: total,
    firedCount,
    refusedCount,
    hitRatePct: Number(hitRatePct.toFixed(2)),
    hitsByStrategy,
    hits,
    refusalHistogram,
    marketCapBuckets,
    liquidityBuckets,
    summaryMarkdown,
  }
}

function formatSummaryMarkdown(data: {
  total: number
  firedCount: number
  refusedCount: number
  hitRatePct: number
  hitsByStrategy: Record<StrategyId, number>
  refusalHistogram: Record<string, number>
  marketCapBuckets: StrategyBacktestReport['marketCapBuckets']
  liquidityBuckets: StrategyBacktestReport['liquidityBuckets']
}): string {
  const lines: string[] = []
  lines.push('## Strategy Backtest Summary')
  lines.push(`- **Total Candidates Replayed:** ${data.total}`)
  lines.push(`- **Setups Fired:** ${data.firedCount} (${data.hitRatePct.toFixed(1)}% hit rate)`)
  lines.push(`- **Setups Refused (Filtered):** ${data.refusedCount}`)
  lines.push('')
  lines.push('### Hits by Playbook Strategy')
  lines.push(`- **Second Wave ($2M–$6M):** ${data.hitsByStrategy.second_wave}`)
  lines.push(`- **Level Flip ($8M–$15M):** ${data.hitsByStrategy.level_flip}`)
  lines.push(`- **Whale Comeback ($10M–$45M):** ${data.hitsByStrategy.whale_comeback}`)
  lines.push('')
  lines.push('### Candidate Market Cap Distribution')
  lines.push(`- <$1M (Below bands): ${data.marketCapBuckets.under1M}`)
  lines.push(`- $1M–$2M (Deadzone): ${data.marketCapBuckets.band1M_2M}`)
  lines.push(`- $2M–$6M (Second Wave band): ${data.marketCapBuckets.band2M_6M}`)
  lines.push(`- $6M–$8M (Deadzone): ${data.marketCapBuckets.band6M_8M}`)
  lines.push(`- $8M–$15M (Level Flip band): ${data.marketCapBuckets.band8M_15M}`)
  lines.push(`- $15M–$45M (Whale Comeback band): ${data.marketCapBuckets.band15M_45M}`)
  lines.push(`- >$45M (Above bands): ${data.marketCapBuckets.above45M}`)
  lines.push('')
  lines.push('### Top Refusal Reasons (Why Setups Failed)')
  const sortedRefusals = Object.entries(data.refusalHistogram).sort((a, b) => b[1] - a[1])
  for (const [rule, count] of sortedRefusals.slice(0, 8)) {
    lines.push(`- **${rule}:** ${count} refusal(s)`)
  }
  return lines.join('\n')
}

export async function fetchHistoricalCandidates(
  opts: BacktestOptions,
): Promise<BacktestCandidate[]> {
  if (opts.candidates && opts.candidates.length > 0) {
    return opts.candidates
  }

  const limit = opts.limit ?? 50
  const source = opts.source ?? 'both'
  const candidates: BacktestCandidate[] = []
  const seen = new Set<string>()

  if (source === 'both' || source === 'call_feed') {
    try {
      const calls = await prisma.callFeed.findMany({
        where: { chain: 'solana' },
        orderBy: { lastSeenAt: 'desc' },
        take: limit,
      })
      for (const c of calls) {
        if (!seen.has(c.contract)) {
          seen.add(c.contract)
          candidates.push({
            contract: c.contract,
            symbol: c.ticker || 'UNKNOWN',
            chain: c.chain,
            marketCapUsd: c.marketCapUsd ?? null,
            liquidityUsd: null,
            volume24hUsd: null,
            firstSeen: c.lastSeenAt,
          })
        }
      }
    } catch {
      // Prisma read failure falls through
    }
  }

  if ((source === 'both' || source === 'launch_token') && candidates.length < limit) {
    try {
      const launches = await prisma.launchToken.findMany({
        where: { chain: 'solana' },
        orderBy: { firstSeen: 'desc' },
        take: limit - candidates.length,
      })
      for (const l of launches) {
        if (!seen.has(l.address)) {
          seen.add(l.address)
          candidates.push({
            contract: l.address,
            symbol: l.symbol || 'UNKNOWN',
            chain: l.chain,
            marketCapUsd: l.marketCapUsd ?? null,
            liquidityUsd: l.liquidityUsd ?? null,
            volume24hUsd: l.volume24hUsd ?? null,
            firstSeen: l.firstSeen,
          })
        }
      }
    } catch {
      // Prisma read failure falls through
    }
  }

  return candidates
}

export async function runStrategyBacktest(
  opts: BacktestOptions = {},
): Promise<StrategyBacktestReport> {
  const candidates = await fetchHistoricalCandidates(opts)
  const results: StrategyIntakeResult[] = []

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i]
    const mc = cand.marketCapUsd
    const mcLabel = mc ? `$${Math.round(mc).toLocaleString()}` : 'unmeasured'
    console.log(`[strategy-backtest] [${i + 1}/${candidates.length}] evaluating ${cand.symbol} (${cand.contract.slice(0, 8)}… MC=${mcLabel})`)

    const market: MarketRow = {
      symbol: cand.symbol,
      marketCapUsd: cand.marketCapUsd,
      liquidityUsd: cand.liquidityUsd,
      volume24hUsd: cand.volume24hUsd,
      pairCreatedAtMs: cand.firstSeen ? cand.firstSeen.getTime() : null,
    }

    // Fast path: if MC is known and strictly below $1,000,000, all three strategy
    // bands (Second Wave $2M+, Level Flip $8M+, Whale Comeback $10M+) fail the
    // mc-band rule. Avoid a 10s GeckoTerminal OHLCV fetch when refusal is guaranteed.
    if (mc !== null && mc > 0 && mc < 1_000_000) {
      results.push({
        contract: cand.contract,
        fired: null,
        verdicts: [],
        structure: null,
        seriesFailure: null,
        ladder: null,
        structureLines: [],
        refusals: [
          `Second Wave — mc-band: MC $${(mc / 1e6).toFixed(2)}M vs $2.0M-$6.0M band (BELOW band)`,
          `Level Flip — mc-band: MC $${(mc / 1e6).toFixed(2)}M vs $8.0M-$15.0M band (BELOW band)`,
          `Whale Comeback — mc-band: MC $${(mc / 1e6).toFixed(2)}M vs $10.0M-$45.0M band (BELOW band)`,
        ],
        guardSource: null,
        confluence: EMPTY_CONFLUENCE(cand.contract),
        confluenceLine: 'confluence unmeasured',
        confluenceBar: null,
      })
      continue
    }

    try {
      const evalPromise = evaluateStrategiesFor({
        contract: cand.contract,
        buyers: [],
        buyerStatus: new Map(),
        market,
        fetchFn: opts.fetchFn,
      })
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('evaluation timeout (10s)')), 10_000),
      )
      const res = await Promise.race([evalPromise, timeoutPromise])
      results.push(res)
    } catch (err) {
      results.push({
        contract: cand.contract,
        fired: null,
        verdicts: [],
        structure: null,
        seriesFailure: 'throttled',
        ladder: null,
        structureLines: [],
        refusals: [`evaluation-error: ${err instanceof Error ? err.message : String(err)}`],
        guardSource: null,
        confluence: EMPTY_CONFLUENCE(cand.contract),
        confluenceLine: 'confluence unmeasured',
        confluenceBar: null,
      })
    }
  }
  return compileBacktestReport(candidates, results)
}
