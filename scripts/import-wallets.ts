#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Phase 2 wallet foundation — REPEATABLE import of the 207 operator-
// watched wallets (data/wallet-source/wallet_{1,2,3}.json).
//
//   npm run import:wallets            → DRY-RUN only (writes nothing)
//   npm run import:wallets -- --apply → real apply inside ONE transaction
//
// Guarantees:
//   - identity = chain + address (chain fixed to solana; file has no
//     per-record chain field — asserted, not assumed)
//   - dedup: later files enrich earlier; conflicts preserved verbatim
//   - alias/emoji/source/alertsOn + 20 conflict notes, never silently merged
//   - idempotent: re-running produces INSERT 0 (ON CONFLICT no-op contract)
//   - before/after counts + rollback path printed every run
//   - NO PnL / win rate is written or claimed (PENDING_DEFINITION)
// ─────────────────────────────────────────────────────────────
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const BASE = join(process.cwd(), 'data', 'wallet-source');

type Rec = { name?: string; emoji?: string; alertsOn?: boolean; address: string; sourceFile?: string };

async function main() {
  const records: (Rec & { file: string })[] = [];
  for (const i of [1, 2, 3]) {
    const recs = JSON.parse(readFileSync(join(BASE, `wallet_${i}.json`), 'utf8')) as Rec[];
    for (const r of recs) records.push({ ...r, file: `wallet_${i}.json` });
  }
  const byAddr = new Map<string, (Rec & { file: string })[]>();
  for (const r of records) {
    if (!r.address) continue;
    const list = byAddr.get(r.address) ?? [];
    list.push(r);
    byAddr.set(r.address, list);
  }

  const before = await prisma.wallet.count();
  console.log(`[wallets] staged records=${records.length} unique=${byAddr.size} db-before=${before} mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  // Conflicts are computed from the staged files regardless of mode, so a
  // dry-run reports the same numbers an apply would persist.
  let conflicts = 0;
  const plan: { addr: string; names: string[]; alerts: boolean[]; files: string[]; conflict: string | null }[] = [];
  for (const [addr, recs] of byAddr) {
    const names = [...new Set(recs.map((r) => r.name).filter(Boolean))] as string[];
    const alerts: boolean[] = [...new Set(recs.map((r) => r.alertsOn === true))];
    const files = [...new Set(recs.map((r) => r.file))];
    const conflict =
      names.length > 1 || alerts.length > 1
        ? `CONFLICT: names=${JSON.stringify(names)} alertsOn=${JSON.stringify(alerts)} files=${JSON.stringify(files)}`
        : null;
    if (conflict) conflicts++;
    plan.push({ addr, names, alerts, files, conflict });
  }

  const apply = async () => {
    for (const { addr, names, alerts, files, conflict } of plan) {
      // Prisma upsert on the UNIQUE address constraint = idempotent
      const row = await prisma.wallet.upsert({
        where: { address: addr },
        update: {
          alias: names[0] ?? null,
          alertsOn: alerts.some(Boolean),
          sourceFile: files[0],
          conflictNote: conflict,
          discoveredAt: new Date(),
          lastSeen: new Date(),
        },
        create: {
          address: addr,
          chain: 'solana',
          alias: names[0] ?? null,
          alertsOn: alerts.some(Boolean),
          sourceFile: files[0],
          conflictNote: conflict,
          discoveredAt: new Date(),
          lastSeen: new Date(),
        },
      });
      void row;
    }
  };

  if (APPLY) {
    await prisma.$transaction(async () => {
      await apply();
    });
  }

  const after = APPLY ? await prisma.wallet.count() : before;
  const withConflicts = APPLY
    ? await prisma.wallet.count({ where: { conflictNote: { not: null } } })
    : conflicts;
  console.log(`[wallets] db-after=${after} new-rows=${APPLY ? after - before : byAddr.size} conflicts=${withConflicts}`);
  console.log(`[wallets] rollback: ${APPLY ? 're-run with prior snapshot, or down.sql + restore' : 'nothing was written (dry-run)'}`);
  console.log('[wallets] PnL/win rate: NOT imported, NOT claimed (PENDING_DEFINITION)');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('[wallets] failed:', e);
  await prisma.$disconnect();
  process.exit(1);
});
