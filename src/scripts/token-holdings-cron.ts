#!/usr/bin/env node
import { recordPipelineRun } from '@/lib/modules/derived/pipeline-heartbeat'
// ─────────────────────────────────────────────────────────────
// Token holdings cron — populate TokenHolding from GMGN holder data.
//
// Runs the token-holdings persist pipeline:
//   1. Load distinct contracts from WalletBuySignal (addedAt DESC)
//   2. For each token: fetch top holders via listGmgnTokenHolders
//   3. For each holder: upsert Wallet + Token + TokenHolding
//
// This fills the gap: TokenHolding has ZERO rows linked to whale-classified
// wallets, so resolveCrossTokenContext() always returns 'unknown'.
//
// Receipt logging + exit code. Scheduling is crontab-based, not
// in-process setInterval (mirrors whale-buy-scan-cron.ts).
//
// Run: npm run cron:token-holdings
// Env:
//   TOKEN_HOLDINGS_ENABLED      — 'true' to enable (default OFF)
//   TOKEN_HOLDINGS_LIMIT        — tokens per pass (default 15)
//   TOKEN_HOLDINGS_HOLDER_LIMIT — holders per token (default 20)
// ─────────────────────────────────────────────────────────────

import 'dotenv/config'

import { persistTokenHoldings } from '@/lib/modules/derived/token-holdings-persist'

function numEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

async function main(): Promise<void> {
  // Master env gate (mirrors KOL_MONITOR_ENABLED / SNIPER_CONFLUENCE_ENABLED):
  // the whole cron is a no-op unless the literal "true".
  if (process.env.TOKEN_HOLDINGS_ENABLED !== 'true') {
    console.log("[token-holdings] disabled (TOKEN_HOLDINGS_ENABLED != 'true')")
    return
  }

  const now = Date.now()
  const tokenLimit = numEnv('TOKEN_HOLDINGS_LIMIT', 15)
  const holderLimit = numEnv('TOKEN_HOLDINGS_HOLDER_LIMIT', 20)

  console.log(
    `[token-holdings] ${new Date(now).toISOString()} — starting ` +
      `(tokenLimit=${tokenLimit} holderLimit=${holderLimit})`,
  )

  const result = await persistTokenHoldings({ tokenLimit, holderLimit })

  console.log(
    `[token-holdings] scanned tokens=${result.tokensScanned} ` +
      `holdingsUpserted=${result.holdingsUpserted} ` +
      `holdersSkipped=${result.holdersSkipped} ` +
      `errors=${result.errors.length}`,
  )

  if (result.errors.length > 0) {
    for (const e of result.errors.slice(0, 10)) {
      console.log(`[token-holdings]   ↳ ${e}`)
    }
    if (result.errors.length > 10) {
      console.log(`[token-holdings]   ... and ${result.errors.length - 10} more`)
    }
  }

  console.log(
    `[token-holdings] done: tokens=${result.tokensScanned} ` +
      `upserted=${result.holdingsUpserted} skipped=${result.holdersSkipped} ` +
      `errors=${result.errors.length}`,
  )
}

main()
  .catch((err) => {
    console.error('[token-holdings] FATAL:', err)
    void recordPipelineRun('token-holdings', false, `FATAL: ${err instanceof Error ? err.message : String(err)}`)
  })
  .finally(() => {
    process.exit(0)
  })
