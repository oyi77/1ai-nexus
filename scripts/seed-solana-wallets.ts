#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Solana wallet seed — one-shot collector for the sniper's wallet DB.
//
// Pipeline gap (measured 2026-10-12): the Wallet table holds 20,787 rows
// but all EVM chains; only 6 claim solana and all are 0x-mislabeled, so
// getRefreshCandidates returns zero and no Solana wallet ever classifies.
// The sniper's sm=none follows directly.
//
// This fills the gap at the cheapest layer: GMGN trending Solana tokens
// → top holders per token → Wallet rows (chain=solana). Classification
// stays in wallet-refresh-cron (harvest → classify → persist); this script
// only SEEDS addresses, never invents PnL.
//
// Second source (--from-gmgn-rank): GMGN's wallet leaderboard
// (listGmgnWalletRank('smart_degen','7d'), falling back to 'top_traders'
// when the primary tag returns nothing) → Wallet rows (chain=solana). This
// seeds wallets GMGN already MEASURED instead of raw token holders.
//
// Idempotent: address is @unique, upsert no-ops on rerun.
// Run: npx tsx scripts/seed-solana-wallets.ts [--apply] [--tokens N] [--holders N]
//      npx tsx scripts/seed-solana-wallets.ts --from-gmgn-rank [--apply]
//        [--rank-limit N] [--min-winrate F] [--min-tx N]
//   default is DRY-RUN (counts only, writes nothing).
//   --from-gmgn-rank  seed from the GMGN wallet leaderboard, not token holders
//   --rank-limit N    max leaderboard rows considered (default 100)
//   --min-winrate F   keep winRate30d >= F; null/unknown always passes (default 0)
//   --min-tx N        keep txCount30d >= N; null/unknown always passes (default 0)
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { discoverGmgnTokens, listGmgnWalletRank } from '@/lib/modules/meme/gmgn'
import { fetchTopHolders } from '@/lib/modules/derived/wallet-tracer'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')
const FROM_GMGN_RANK = process.argv.includes('--from-gmgn-rank')
const arg = (flag: string, dflt: number): number => {
  const i = process.argv.indexOf(flag)
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : dflt
}
/** Like arg(), but 0 is a meaningful value (a threshold) and fractions pass. */
const floatArg = (flag: string, dflt: number): number => {
  const i = process.argv.indexOf(flag)
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN
  return Number.isFinite(v) ? v : dflt
}
const MAX_TOKENS = arg('--tokens', 25)
const HOLDERS_PER_TOKEN = arg('--holders', 12)
const RANK_LIMIT = arg('--rank-limit', 100)
const MIN_WINRATE = floatArg('--min-winrate', 0)
const MIN_TX = arg('--min-tx', 0)
const isSolanaAddr = (a: string): boolean => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)


async function seedFromTrendingHolders(): Promise<void> {
  console.log(`[seed-solana] mode=${APPLY ? 'APPLY' : 'DRY-RUN'} tokens<=${MAX_TOKENS} holders<=${HOLDERS_PER_TOKEN}`)
  const tokens = (await discoverGmgnTokens(30)).filter(
    (t) => (t.chain ?? '').toLowerCase() === 'solana' && isSolanaAddr(t.contract),
  )
  console.log(`[seed-solana] trending solana tokens=${tokens.length}`)
  const picked = tokens.slice(0, MAX_TOKENS)

  const byAddr = new Map<string, { sources: Set<string> }>()
  let tokenOk = 0
  for (const t of picked) {
    try {
      const holders = await fetchTopHolders(t.contract, HOLDERS_PER_TOKEN)
      if (holders.length > 0) tokenOk++
      for (const h of holders) {
        if (!isSolanaAddr(h.owner)) continue
        const e = byAddr.get(h.owner) ?? { sources: new Set<string>() }
        e.sources.add(t.contract.slice(0, 8))
        byAddr.set(h.owner, e)
      }
    } catch {
      /* one dead token never kills the seed */
    }
  }
  const before = await prisma.wallet.count({ where: { chain: 'solana' } })
  console.log(`[seed-solana] tokens-ok=${tokenOk}/${picked.length} unique-holders=${byAddr.size} solana-before=${before}`)

  if (!APPLY) {
    console.log('[seed-solana] DRY-RUN: nothing written. Re-run with --apply.')
    return
  }
  let inserted = 0
  for (const [addr, e] of byAddr) {
    try {
      const r = await prisma.wallet.upsert({
        where: { address: addr },
        create: {
          address: addr,
          chain: 'solana',
          labels: ['gmgn-holder'],
          riskScore: 0,
          lastSeen: new Date(),
          sourceFile: `seed-solana:${[...e.sources].slice(0, 3).join(',')}`,
          discoveredAt: new Date(),
        },
        update: { lastSeen: new Date() },
      })
      // createdAt == now within skew means this upsert inserted.
      if (Date.now() - r.createdAt.getTime() < 60_000) inserted++
    } catch {
      /* one bad row never kills the seed */
    }
  }
  const after = await prisma.wallet.count({ where: { chain: 'solana' } })
  console.log(`[seed-solana] inserted~${inserted} solana-after=${after}`)
}

/**
 * Leaderboard seeder: GMGN already publishes a measured per-wallet record,
 * so these rows enter the Wallet table with provenance (tag) rather than
 * being inferred. Never invents metrics — only addresses are written.
 */
async function seedFromGmgnRank(): Promise<void> {
  console.log(
    `[seed-solana] mode=${APPLY ? 'APPLY' : 'DRY-RUN'} from=gmgn-rank limit<=${RANK_LIMIT} min-winrate>=${MIN_WINRATE} min-tx>=${MIN_TX}`,
  )
  // Primary tag, then the documented fallback when the leaderboard refuses
  // or comes back empty ([] means "no data", never fabricated rows).
  let tag = 'smart_degen'
  let rows = await listGmgnWalletRank(tag, '7d')
  if (rows.length === 0) {
    tag = 'top_traders'
    rows = await listGmgnWalletRank(tag, '7d')
  }
  console.log(`[seed-solana] gmgn-rank tag=${tag} window=7d raw-rows=${rows.length}`)

  const ranked = rows.slice(0, RANK_LIMIT)
  const byAddr = new Map<string, true>()
  for (const r of ranked) {
    if (!isSolanaAddr(r.address)) continue
    // Null means "unproven", never "guilty": a missing metric passes the
    // filter rather than disqualifying the wallet.
    if (r.winRate30d !== null && r.winRate30d < MIN_WINRATE) continue
    if (r.txCount30d !== null && r.txCount30d < MIN_TX) continue
    byAddr.set(r.address, true)
  }
  const before = await prisma.wallet.count({ where: { chain: 'solana' } })
  let inserted = 0
  if (APPLY) {
    for (const addr of byAddr.keys()) {
      try {
        const r = await prisma.wallet.upsert({
          where: { address: addr },
          create: {
            address: addr,
            chain: 'solana',
            labels: ['gmgn-rank', tag],
            riskScore: 0,
            lastSeen: new Date(),
            sourceFile: `seed-solana:gmgn-rank:${tag}`,
            discoveredAt: new Date(),
          },
          update: { lastSeen: new Date() },
        })
        // createdAt == now within skew means this upsert inserted.
        if (Date.now() - r.createdAt.getTime() < 60_000) inserted++
      } catch {
        /* one bad row never kills the seed */
      }
    }
  }
  const after = APPLY ? await prisma.wallet.count({ where: { chain: 'solana' } }) : before
  console.log(
    `[seed-solana] rank-rows=${ranked.length} unique-holders=${byAddr.size} solana-before=${before} inserted~${inserted} solana-after=${after}`,
  )
  if (!APPLY) console.log('[seed-solana] DRY-RUN: nothing written. Re-run with --apply.')
}

async function main() {
  if (FROM_GMGN_RANK) return seedFromGmgnRank()
  return seedFromTrendingHolders()
}

main()
  .catch((e) => {
    console.error('[seed-solana] failed:', e)
    process.exit(1)
  })
  .finally(() => void prisma.$disconnect().finally(() => process.exit(0)))
