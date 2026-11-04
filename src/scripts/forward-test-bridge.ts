#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────
// Forward-test bridge — registers HIGH-CONVICTION whale candidates
// into the live sniper outcome log (forward-test, non-custodial).
//
// Pipeline (reuses existing modules, zero new abstractions):
//   1. Candidates = recent Solana buy legs > $1k, one EARLIEST buy per mint.
//   2. "Strong confluence" = WalletBuySignal row with >= MIN_BUYERS buyers.
//      "Unresolved" = mint not already present in the outcome log.
//   3. Entry MC = GeckoTerminal MC series close bar covering the decision
//      instant (bar.closeUsd = close × supply). Unreadable series / missing
//      bar → candidate SKIPPED (never register UNPRICEABLE on portably flaky
//      fetches; registerDelivered is first-write-wins and poisoning persists).
//   4. registerDelivered + saveOutcomes (prisma.sniperSignalOutcome upsert
//      + dual-write data/sniper-outcomes.json).
//   5. Verify mutation in BOTH stores via readOutcomes + prisma count.
//
// Run: npx tsx src/scripts/forward-test-bridge.ts
// Env:
//   FTB_LOOKBACK_DAYS  (default 7)
//   FTB_MIN_BUY_USD    (default 1_000)
//   FTB_MIN_BUYERS     (default 2)
//   FTB_MAX_TOKENS     (default 15)
// ─────────────────────────────────────────────────────────────
import 'dotenv/config';
import { prisma } from '@/lib/db';
import { SOL_MINT, USDC_MINT } from '@/lib/modules/derived/historical-price';
import { fetchMcSeries } from '@/lib/modules/derived/mc-series';
import {
  registerDelivered,
  readOutcomes,
} from '@/lib/modules/derived/sniper-outcomes';
import { loadOutcomeLog, saveOutcomes } from '@/lib/modules/derived/db-stores';
import { loadWalletBuys } from '@/lib/modules/derived/db-wallet-buys';

const STABLES: Record<string, true> = { [SOL_MINT]: true, [USDC_MINT]: true };
const LOOKBACK_DAYS = numEnv('FTB_LOOKBACK_DAYS', 7);
const MIN_BUY_USD = numEnv('FTB_MIN_BUY_USD', 1_000);
const MIN_BUYERS = numEnv('FTB_MIN_BUYERS', 2);
const MAX_TOKENS = numEnv('FTB_MAX_TOKENS', 15);

function numEnv(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

async function main(): Promise<void> {
  console.log('=== FORWARD-TEST BRIDGE ===');
  console.log(`lookback=${LOOKBACK_DAYS}d minBuy=$${MIN_BUY_USD} minBuyers=${MIN_BUYERS} maxTokens=${MAX_TOKENS}`);

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
  const legs = await prisma.transaction.findMany({
    where: {
      timestamp: { gte: since },
      side: 'buy',
      chain: 'solana',
      amountUsd: { gt: MIN_BUY_USD },
      tokenAddress: { not: null },
    },
    select: { tokenAddress: true, timestamp: true, amountUsd: true },
    orderBy: { timestamp: 'asc' },
    take: 5_000,
  });

  const firstBuy = new Map<string, { at: number }>();
  for (const leg of legs) {
    const mint = leg.tokenAddress!;
    if (STABLES[mint] || firstBuy.has(mint)) continue;
    firstBuy.set(mint, { at: leg.timestamp.getTime() });
  }
  console.log(`legs=${legs.length} uniqueMints=${firstBuy.size}`);

  const logBefore = await loadOutcomeLog();
  const known = new Set(logBefore.signals.map((s) => s.contract));
  const walletBuys = await loadWalletBuys();
  const confluence = new Map(walletBuys.map((r) => [r.contract, r]));
  const tickers = new Map(
    (
      await prisma.token.findMany({
        where: { chain: 'solana', address: { in: [...firstBuy.keys()] } },
        select: { address: true, symbol: true },
      })
    ).map((t) => [t.address, t.symbol]),
  );

  const candidates = [...firstBuy.entries()]
    .filter(([mint]) => !known.has(mint))
    .filter(([mint]) => {
      const wb = confluence.get(mint);
      return wb !== undefined && wb.buyers.length >= MIN_BUYERS;
    })
    .sort((a, b) => (confluence.get(b[0])!.buyVolumeUsd - confluence.get(a[0])!.buyVolumeUsd))
    .slice(0, MAX_TOKENS);
  console.log(`strongConfluenceUnresolved=${candidates.length}`);

  let log = logBefore;
  let priced = 0;
  let skipped = 0;
  for (const [mint, { at }] of candidates) {
    const wb = confluence.get(mint)!;
    const series = await fetchMcSeries(mint);
    if (!series) {
      skipped += 1;
      console.log(`  ${mint.slice(0, 10)}… buyers=${wb.buyers.length} vol=$${Math.round(wb.buyVolumeUsd).toLocaleString()} SKIPPED (no series)`);
      continue;
    }
    const bar = series.bars.find((b) => b.timeMs >= at) ?? series.bars[0];
    if (!bar) {
      skipped += 1;
      console.log(`  ${mint.slice(0, 10)}… buyers=${wb.buyers.length} vol=$${Math.round(wb.buyVolumeUsd).toLocaleString()} SKIPPED (no bar)`);
      continue;
    }
    const entryMc = bar.closeUsd;
    priced += 1;
    log = registerDelivered(log, {
      contract: mint,
      ticker: tickers.get(mint) ?? 'UNKNOWN',
      tier: 'HIGH_CONVICTION',
      entryMarketCapUsd: entryMc,
      deliveredAt: new Date(at).toISOString(),
      profileIds: [],
      profileBreaches: [],
    });
    console.log(
      `  ${mint.slice(0, 10)}… buyers=${wb.buyers.length} vol=$${Math.round(wb.buyVolumeUsd).toLocaleString()} ` +
        `entry=$${Math.round(entryMc).toLocaleString()} (${series.source})`,
    );
  }
  await saveOutcomes(log);

  // Verify mutation in BOTH stores.
  const dbRows = await prisma.sniperSignalOutcome.findMany({
    where: { contract: { in: candidates.map(([m]) => m) } },
    select: { contract: true, signalId: true },
  });
  const jsonLog = readOutcomes();
  const jsonHits = candidates.filter(([m]) => jsonLog.signals.some((s) => s.contract === m));
  console.log('\n--- VERIFICATION ---');
  console.log(`db.sniperSignalOutcome rows for candidates: ${dbRows.length}/${candidates.length}`);
  console.log(`data/sniper-outcomes.json signals for candidates: ${jsonHits.length}/${candidates.length}`);

  const pending = log.signals.filter((s) => s.verdict === 'PENDING').length;
  console.log('\n--- STATS ---');
  console.log(
    `registered=${priced} skipped=${skipped} ` +
      `logTotal=${log.signals.length} pending=${pending} registeredAttempted=${candidates.length}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
