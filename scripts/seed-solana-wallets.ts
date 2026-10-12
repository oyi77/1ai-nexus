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
// Idempotent: address is @unique, upsert no-ops on rerun.
// Run: npx tsx scripts/seed-solana-wallets.ts [--apply] [--tokens N] [--holders N]
//   default is DRY-RUN (counts only, writes nothing).
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { discoverGmgnTokens } from '@/lib/modules/meme/gmgn'
import { fetchTopHolders } from '@/lib/modules/derived/wallet-tracer'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')
const arg = (flag: string, dflt: number): number => {
  const i = process.argv.indexOf(flag)
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : dflt
}
const MAX_TOKENS = arg('--tokens', 25)
const HOLDERS_PER_TOKEN = arg('--holders', 12)

const isSolanaAddr = (a: string): boolean => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)

async function main() {
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

main()
  .catch((e) => {
    console.error('[seed-solana] failed:', e)
    process.exit(1)
  })
  .finally(() => void prisma.$disconnect().finally(() => process.exit(0)))
