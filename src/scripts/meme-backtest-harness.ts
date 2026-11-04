#!/usr/bin/env tsx
import 'dotenv/config';
import { prisma } from '@/lib/db';
import {
  fetchHistoricalTokenUsd,
  fetchTokenBarSeries,
  SOL_MINT,
  USDC_MINT,
} from '@/lib/modules/derived/historical-price';

/**
 * MEME BACKTEST HARNESS — entry → forward return, honest labels.
 *
 * Protocol (locked):
 *  1. Candidates = Solana buy legs > $1k over the last 30d, one EARLIEST
 *     buy per mint (the decision instant). Stable mints excluded.
 *  2. Entry price = GeckoTerminal close at the decision instant,
 *     plus a 2% slippage haircut and 0.3% round-trip fee.
 *  3. Forward outcome = bars strictly AFTER entry, up to HORIZON.
 *     `fetchTokenBarSeries` pages BACKWARD from atMs, so we anchor at
 *     entry+horizon and then drop every bar before entry. Using the
 *     un-filtered series would price pre-entry history as if it were the
 *     future — that bug produced the earlier 2.13% / -100% artifact.
 *  4. Labels:
 *       NO_DATA = GeckoTerminal gave us nothing usable (pool-not-found,
 *                 rate-limited, http error). Excluded from every return
 *                 statistic — a rate limit is not a rug.
 *       RUG     = entry priced, but no bar exists after entry (pool gone).
 *                 Booked as -100%.
 *       WIN/LOSS= priced forward return.
 */

const HORIZON_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SLIPPAGE = 0.02; // 2% entry slippage on thin books
const FEE_RT = 0.003; // 0.3% round-trip
const LOOKBACK_DAYS = 30;
const MIN_BUY_USD = 1_000;
// 20 tokens × ~2 GeckoTerminal calls × 2s central limiter ≈ 80s of quota —
// stays inside the ~30 calls/minute public tier without a cooldown storm.
const MAX_TOKENS = 20;

type Status = 'WIN' | 'LOSS' | 'RUG' | 'NO_DATA';

interface BacktestResult {
  mint: string;
  entryAt: number;
  entryPrice: number | null;
  peakPrice: number | null;
  exitPrice: number | null;
  returnPct: number | null;
  status: Status;
  note: string;
}

const STABLES: Record<string, true> = {
  [SOL_MINT]: true,
  [USDC_MINT]: true,
};

function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

async function runBacktest() {
  console.log('=== MEME BACKTEST HARNESS ===');
  console.log(`horizon=${HORIZON_MS / 86_400_000}d slippage=${pct(SLIPPAGE)} fee=${pct(FEE_RT)} lookback=${LOOKBACK_DAYS}d minBuy=$${MIN_BUY_USD}`);

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

  // One decision instant per mint = its FIRST qualifying buy.
  const firstBuy = new Map<string, { at: number; usd: number }>();
  for (const leg of legs) {
    const mint = leg.tokenAddress;
    if (!mint || STABLES[mint]) continue;
    if (firstBuy.has(mint)) continue;
    firstBuy.set(mint, { at: leg.timestamp.getTime(), usd: leg.amountUsd });
  }

  const mints = [...firstBuy.keys()].slice(0, MAX_TOKENS);
  console.log(`legs=${legs.length} uniqueMints=${firstBuy.size} replaying=${mints.length}`);

  const results: BacktestResult[] = [];

  for (const mint of mints) {
    const { at: entryAt } = firstBuy.get(mint)!;
    const entrySec = Math.floor(entryAt / 1000);

    try {
      const entry = await fetchHistoricalTokenUsd(mint, entryAt);
      if (!entry.usd) {
        results.push({
          mint, entryAt, entryPrice: null, peakPrice: null, exitPrice: null,
          returnPct: null, status: 'NO_DATA', note: entry.source,
        });
        continue;
      }

      // Anchor at entry+horizon, then keep only post-entry bars.
      const series = await fetchTokenBarSeries(mint, {
        timeframe: 'hour',
        atMs: entryAt + HORIZON_MS,
      });

      if (series.source !== 'geckoterminal:ohlcv') {
        results.push({
          mint, entryAt, entryPrice: entry.usd, peakPrice: null, exitPrice: null,
          returnPct: null, status: 'NO_DATA', note: series.source,
        });
        continue;
      }

      const forward = series.bars.filter((b) => b.time >= entrySec);
      if (forward.length === 0) {
        results.push({
          mint, entryAt, entryPrice: entry.usd, peakPrice: null, exitPrice: null,
          returnPct: null, status: 'RUG', note: 'no forward bar (pool gone)',
        });
        continue;
      }

      const effectiveEntry = entry.usd * (1 + SLIPPAGE);
      const peakPrice = Math.max(...forward.map((b) => b.high));
      const exitPrice = forward[forward.length - 1].close;
      const returnPct = (exitPrice * (1 - FEE_RT) - effectiveEntry) / effectiveEntry;

      results.push({
        mint, entryAt, entryPrice: entry.usd, peakPrice, exitPrice, returnPct,
        status: returnPct > 0 ? 'WIN' : 'LOSS',
        note: `${forward.length} forward bars`,
      });
    } catch (e) {
      results.push({
        mint, entryAt, entryPrice: null, peakPrice: null, exitPrice: null,
        returnPct: null, status: 'NO_DATA',
        note: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // ── Report ────────────────────────────────────────────────
  const byStatus: Record<Status, number> = { WIN: 0, LOSS: 0, RUG: 0, NO_DATA: 0 };
  for (const r of results) byStatus[r.status] += 1;

  const priced = results.filter((r) => r.returnPct !== null);
  const returns = priced.map((r) => r.returnPct as number).sort((a, b) => a - b);
  const wins = returns.filter((r) => r > 0);
  const peakMultiples = priced
    .filter((r) => r.entryPrice && r.peakPrice)
    .map((r) => (r.peakPrice as number) / (r.entryPrice as number) * (1 - SLIPPAGE) * (1 - FEE_RT))
    .sort((a, b) => a - b);

  const pctile = (arr: number[], p: number): number | null =>
    arr.length === 0 ? null : arr[Math.min(arr.length - 1, Math.floor((arr.length - 1) * p))];

  console.log('\n--- COUNTS ---');
  console.log(`total=${results.length} WIN=${byStatus.WIN} LOSS=${byStatus.LOSS} RUG=${byStatus.RUG} NO_DATA=${byStatus.NO_DATA}`);
  console.log(`priced=${priced.length} (NO_DATA excluded from returns)`);

  if (returns.length > 0) {
    console.log('\n--- FORWARD RETURN @ HORIZON ---');
    console.log(`precision=${pct(wins.length / returns.length)}`);
    console.log(`median=${pct(pctile(returns, 0.5) as number)}`);
    console.log(`p25=${pct(pctile(returns, 0.25) as number)} p75=${pct(pctile(returns, 0.75) as number)}`);
    console.log(`min=${pct(returns[0])} max=${pct(returns[returns.length - 1])}`);
  }
  if (peakMultiples.length > 0) {
    console.log('\n--- PEAK MULTIPLE (best-case exit, post-entry) ---');
    console.log(`median=${(pctile(peakMultiples, 0.5) as number).toFixed(2)}x p75=${(pctile(peakMultiples, 0.75) as number).toFixed(2)}x max=${peakMultiples[peakMultiples.length - 1].toFixed(2)}x`);
    console.log(`>=2x: ${peakMultiples.filter((m) => m >= 2).length}/${peakMultiples.length}`);
  }
  console.log('\n--- PER-TOKEN ---');
  for (const r of results) {
    console.log(
      `${r.mint.slice(0, 10)}… ${r.status.padEnd(7)} ` +
      `ret=${r.returnPct === null ? 'n/a' : pct(r.returnPct)} ` +
      `entry=${r.entryPrice ?? 'n/a'} peak=${r.peakPrice ?? 'n/a'} (${r.note})`,
    );
  }
}

runBacktest().catch((e) => {
  console.error(e);
  process.exit(1);
});