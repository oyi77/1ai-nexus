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
//   WALLET_DISCOVERY_MAX_EMPTY      holder leg stops after N empty tokens (default 2)
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

  for (const w of result.discovered.slice(0, 15)) {
    const wr = ((w.winRate30d ?? 0) * 100).toFixed(1)
    const pnl = (w.pnl30d ?? 0).toFixed(2)
    console.log(
      `  ${w.address.slice(0, 8)}… wr=${wr}% pnl=${pnl} leg=${w.leg} verdict=${w.verdict ?? '-'} ` +
        `human=${w.human.verdict}`,
    )
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
