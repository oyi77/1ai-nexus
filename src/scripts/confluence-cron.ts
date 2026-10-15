#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Smart-money confluence cron (Fase 3 wiring).
//
// Turns the PURE confluence detector into a live confirmation signal:
// collect real buy legs from every qualified (BULLISH) wallet's recent
// activity, run the sliding-window detector, and push ONE compact HTML
// alert per token to the operator's review chat when N qualified wallets
// bought the same token within one window.
//
// OFF unless the literal "true" — mirrors the dev-history gate pattern
// (SNIPER_DEV_HISTORY_GATE, commit 602d11d): an opt-in env gate whose
// default keeps the existing alert surface byte-for-byte unchanged.
//
// Run: npm run cron:confluence
// Env:
//   SNIPER_CONFLUENCE_ENABLED  — "true" enables; default OFF (exit 0, log)
//   CONFLUENCE_WALLET_LIMIT    — wallets per pass (default 50)
//   CONFLUENCE_SWAP_LIMIT      — activity rows per wallet (default 25)
//   CONFLUENCE_COOLDOWN_MS     — per-mint alert cooldown (default 6h)
//   CONFLUENCE_SEEN_PATH       — override seen-state path
//                                (default data/confluence-seen.json)
// ─────────────────────────────────────────────────────────────

import 'dotenv/config';

import { deliverSniperAlert } from '@/lib/modules/derived/meme-sniper';
import { contractButtons } from '@/lib/modules/derived/signal-tier';
import { detectConfluence, CONFLUENCE_DEFAULTS } from '@/lib/modules/derived/smart-money-confluence';
import { collectConfluenceInput } from '@/lib/modules/derived/confluence-producer';
import {
  markConfluenceSent,
  pruneConfluenceSeenState,
  readConfluenceSeenState,
  renderConfluenceAlert,
  shouldSendConfluence,
  writeConfluenceSeenState,
  writeConfluenceArtifact,
  type ConfluenceWalletRow,
} from '@/lib/modules/derived/confluence-state';
import {
  isConfluenceSeen,
  markConfluenceSeen,
} from '@/lib/modules/derived/db-seen-store';
import { prisma } from '@/lib/db';

/** Operator DM chain — same fallback ladder as the other crons; deliberately
 * does NOT fall back to the sale channel. */
function reviewChatId(): string {
  return (
    process.env.SNIPER_REVIEW_CHAT_ID ||
    process.env.HUB_TELEGRAM_OWNER_CHAT_ID ||
    process.env.TELEGRAM_ADMIN_CHAT_ID ||
    ''
  );
}

function numEnv(name: string, fallback: number): number {
  const parsed = Number.parseFloat(process.env[name] ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Per-wallet classification rows for the alert render. Never throws. */
async function loadWalletRows(): Promise<Map<string, ConfluenceWalletRow>> {
  const map = new Map<string, ConfluenceWalletRow>();
  try {
    const rows = await prisma.smartMoneyWallet.findMany({
      where: { status: { in: ['QUALIFIED_SMART_MONEY', 'WHALE', 'WHALE_AND_SMART_MONEY'] } },
      select: {
        status: true,
        wallet: { select: { address: true, alias: true } },
      },
    });
    for (const row of rows) {
      if (row.wallet?.address) {
        map.set(row.wallet.address, {
          address: row.wallet.address,
          status: row.status ?? 'QUALIFIED',
          alias: row.wallet.alias ?? null,
        });
      }
    }
  } catch (err) {
    console.error(
      `[confluence] wallet rows query failed (alerts render short aliases): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  return map;
}

async function main(): Promise<void> {
  // Opt-in gate — default OFF, log and exit 0.
  if (process.env.SNIPER_CONFLUENCE_ENABLED !== 'true') {
    console.log(
      '[confluence] SNIPER_CONFLUENCE_ENABLED not "true" — gate OFF, nothing to do',
    );
    return;
  }

  const now = Date.now();
  const cooldownMs = numEnv('CONFLUENCE_COOLDOWN_MS', 6 * 60 * 60 * 1000);
  const walletLimit = numEnv('CONFLUENCE_WALLET_LIMIT', 50);
  const swapLimit = numEnv('CONFLUENCE_SWAP_LIMIT', 25);
  console.log(
    `[confluence] ${new Date(now).toISOString()} — starting (walletLimit=${walletLimit} swapLimit=${swapLimit} cooldownMs=${cooldownMs})`,
  );

  const { swaps, qualified, errors } = await collectConfluenceInput({
    walletLimit,
    swapLimit,
  });
  console.log(
    `[confluence] collected wallets=${qualified.size} swaps=${swaps.length} failures=${errors.length}`,
  );

  const result = detectConfluence(swaps, qualified, {
    windowMs: CONFLUENCE_DEFAULTS.windowMs,
    minQualifiedBuyers: CONFLUENCE_DEFAULTS.minQualifiedBuyers,
    minBuyUsd: CONFLUENCE_DEFAULTS.minBuyUsd,
  });
  console.log(
    `[confluence] detector: buyLegsCounted=${result.stats.buyLegsCounted} tokensScanned=${result.stats.tokensScanned} signals=${result.signals.length}`,
  );
  if (result.signals.length > 0) {
    writeConfluenceArtifact(result.signals);
    console.log(
      `[confluence] wrote ${result.signals.length} confluence signal(s) → data/confluence-latest.json`,
    );
  }


  const walletRows = await loadWalletRows();
  let state = pruneConfluenceSeenState(readConfluenceSeenState(), now);
  let sent = 0;
  let suppressed = 0;
  const chat = reviewChatId();

  for (const signal of result.signals) {
    if (!shouldSendConfluence(signal, state, now, cooldownMs) || (await isConfluenceSeen(signal.tokenMint))) {
      suppressed += 1;
      console.log(`[confluence] suppressed (cooldown) ${signal.tokenMint}`);
      continue;
    }
    if (!chat) {
      console.log('[confluence] no review chat configured — signals detected, nothing sent');
      break;
    }
    const rows = signal.qualifiedBuyers.map(
      (a) => walletRows.get(a) ?? { address: a, status: 'QUALIFIED', alias: null },
    );
    const text = renderConfluenceAlert(signal, rows);
    const ok = await deliverSniperAlert(text, chat, contractButtons(signal.tokenMint, 'solana'));
    if (ok) {
      sent += 1;
      state = markConfluenceSent(state, signal.tokenMint, now);
      await markConfluenceSeen(signal.tokenMint);
      console.log(
        `[confluence] sent ${signal.tokenMint} (${signal.qualifiedBuyers.length} buyer(s), $${signal.totalBuyUsd.toFixed(2)})`,
      );
    } else {
      console.error(`[confluence] delivery failed ${signal.tokenMint}`);
    }
  }

  if (sent > 0) writeConfluenceSeenState(state);

  console.log(
    `[confluence] wallets=${qualified.size} swaps=${swaps.length} signals=${result.signals.length} sent=${sent} suppressed=${suppressed} failures=${errors.length}`,
  );
}

main()
  .catch((err) => {
    console.error('[confluence] FATAL:', err);
  })
  .finally(() => {
    process.exit(0);
  });
