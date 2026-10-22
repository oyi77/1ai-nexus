import { recordPipelineRun } from '@/lib/modules/derived/pipeline-heartbeat'
// Wallet discovery cron — refreshes the tracked pool from measured data.
//
// Why this exists: `wallet-refresh` (03:00 daily) depends on KOLSCAN_SESSION,
// and an empty cookie silently produced zero new wallets for days. This cron
// is the KOLSCAN-independent path: GMGN leaderboard sweep + holders of MC>$1M
// tokens, with the operator's anti-bot mandate enforced before any write.
//
// Run: npm run cron:wallet-discovery
// Env:
//   WALLET_DISCOVERY_LIMIT_TOKENS   established tokens to inspect (default 20)
//   WALLET_DISCOVERY_MIN_MC         high-cap threshold USD (default 1_000_000)
//   WALLET_DISCOVERY_MIN_WINRATE    30d win rate floor (default 0.6)
//   WALLET_DISCOVERY_MIN_PNL        30d pnl floor (default 0.7)
//   WALLET_DISCOVERY_MIN_VOLUME     30d buy volume floor (default 250_000)
//   WALLET_DISCOVERY_MAX_FASTTX     anti-bot fastTx ceiling (default 0.5)
//   WALLET_DISCOVERY_CONCURRENCY    parallel GMGN stat calls (default 6)
//   WALLET_DISCOVERY_BUDGET_MS      wall-clock budget per pass (default 120000)
//   WALLET_DISCOVERY_MAX_STAT       stat re-measurements per pass (default 150)
//   WALLET_DISCOVERY_MIN_HOLDER_USD  min high-cap holder position size (default 10_000)
//   WALLET_DISCOVERY_MIN_CALL_GROUPS origin-weighted call groups for a confluence tag (default 2)
//   WALLET_DISCOVERY_TRUSTED_GROUPS  comma-separated groups that always count
//   WALLET_DISCOVERY_DRY            "1" = report only, no DB writes
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import {
  DISCOVERY_DEFAULTS,
  persistWallets,
  runWalletDiscovery,
  type DiscoveryFilters,
} from '@/lib/modules/derived/wallet-discovery-engine'
import { primeGmgnCookieFromDb } from '@/lib/modules/meme/gmgn'

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function listEnv(name: string, fallback: string[] | null): string[] | null {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  const items = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  return items.length > 0 ? items : fallback
}

async function main(): Promise<void> {
  const dry = process.env.WALLET_DISCOVERY_DRY === '1'
  const filters: Partial<DiscoveryFilters> = {
    maxTokens: numEnv('WALLET_DISCOVERY_LIMIT_TOKENS', DISCOVERY_DEFAULTS.maxTokens),
    minEstablishedMc: numEnv('WALLET_DISCOVERY_MIN_MC', DISCOVERY_DEFAULTS.minEstablishedMc),
    minWinRate: numEnv('WALLET_DISCOVERY_MIN_WINRATE', DISCOVERY_DEFAULTS.minWinRate),
    minPnl: numEnv('WALLET_DISCOVERY_MIN_PNL', DISCOVERY_DEFAULTS.minPnl),
    minBuyVolumeUsd: numEnv('WALLET_DISCOVERY_MIN_VOLUME', DISCOVERY_DEFAULTS.minBuyVolumeUsd),
    maxFastTxRatio: numEnv('WALLET_DISCOVERY_MAX_FASTTX', DISCOVERY_DEFAULTS.maxFastTxRatio),
    concurrency: numEnv('WALLET_DISCOVERY_CONCURRENCY', DISCOVERY_DEFAULTS.concurrency),
    budgetMs: numEnv('WALLET_DISCOVERY_BUDGET_MS', DISCOVERY_DEFAULTS.budgetMs),
    maxStatMeasurements: numEnv('WALLET_DISCOVERY_MAX_STAT', DISCOVERY_DEFAULTS.maxStatMeasurements),
    maxEmptyHolderTokens: numEnv('WALLET_DISCOVERY_MAX_EMPTY', DISCOVERY_DEFAULTS.maxEmptyHolderTokens),
    minHolderValueUsd: numEnv('WALLET_DISCOVERY_MIN_HOLDER_USD', DISCOVERY_DEFAULTS.minHolderValueUsd),
    maxRateLimitedTokens: numEnv('WALLET_DISCOVERY_MAX_429', DISCOVERY_DEFAULTS.maxRateLimitedTokens),
    minCallGroups: numEnv('WALLET_DISCOVERY_MIN_CALL_GROUPS', DISCOVERY_DEFAULTS.minCallGroups),
    trustedCallGroups: listEnv('WALLET_DISCOVERY_TRUSTED_GROUPS', DISCOVERY_DEFAULTS.trustedCallGroups),
  }

  console.log(
    `[wallet-discovery] start ${new Date().toISOString()} ` +
      `(tokens=${filters.maxTokens} minMc=${filters.minEstablishedMc} ` +
      `wr>=${filters.minWinRate} pnl>=${filters.minPnl} maxFastTx=${filters.maxFastTxRatio} dry=${dry})`,
  )

  await primeGmgnCookieFromDb().catch(() => undefined)

  const result = await runWalletDiscovery(filters)
  console.log(
    `[wallet-discovery] legs: leaderboard=${result.leaderboardLeg} highCapHolders=${result.highCapLeg} ` +
      `→ accepted=${result.discovered.length} ` +
      `refused(bot=${result.refused.bot} noMeasure=${result.refused.noMeasure} filters=${result.refused.filters})`,
  )
  console.log(
    `[wallet-discovery] call-groups: available=${result.callGroups.feedAvailable} ` +
      `queried=${result.callGroups.tokensQueried} matched=${result.callGroups.tokensMatched} ` +
      `aboveBar=${result.callGroups.tokensAboveBar} effective=${result.callGroups.effectiveGroups} ` +
      `groups=${result.callGroups.groupsSeen.slice(0, 6).join('|') || 'none'}`,
  )
  const buckets = Object.entries(result.filterReasons)
    .map(([rule, summary]) => ({ rule, summary }))
    .sort((a, b) => parseInt(b.summary, 10) - parseInt(a.summary, 10))
  if (buckets.length > 0) {
    console.log(
      `[wallet-discovery] filter refusals: ${buckets
        .map(({ rule, summary }) => `${rule} ${summary}`)
        .join('; ')}`,
    )
  }

  for (const w of result.discovered.slice(0, 15)) {
    const wr = w.winRate30d === null ? 'unmeasured' : `${(w.winRate30d * 100).toFixed(1)}%`
    const pnl = w.pnl30d === null ? 'unmeasured' : w.pnl30d.toFixed(2)
    console.log(
      `  ${w.address.slice(0, 8)}… wr=${wr} pnl=${pnl} leg=${w.leg} ` +
        `admission=${w.admission} human=${w.human.verdict} (${w.reason})`,
    )
  }
  // Every measured refusal, address first: an aggregate count cannot answer
  // "why did this whale not make the pool".
  for (const r of result.refusals.slice(0, 15)) {
    console.log(`  REFUSED ${r.address.slice(0, 8)}… ${r.reason}`)
  }
  if (result.refusals.length > 15) {
    console.log(`  … ${result.refusals.length - 15} more refusal(s)`)
  }

  if (dry) {
    console.log('[wallet-discovery] dry run — no DB writes')
    return
  }

  const written = await persistWallets(result.discovered)
  console.log(`[wallet-discovery] persisted ${written}/${result.discovered.length} wallet(s)`)

  const bots = result.discovered.filter((w) => w.human.verdict !== 'HUMAN').length
  if (bots > 0) {
    // Unreachable by construction (the filter rejects non-HUMAN), but if a
    // future edit ever lets one through this line makes the failure loud.
    console.error(`[wallet-discovery] INVARIANT VIOLATION: ${bots} bot wallet(s) reached persistence`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[wallet-discovery] FATAL:', err instanceof Error ? err.message : String(err))
    void recordPipelineRun('wallet-discovery', false, `FATAL: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
