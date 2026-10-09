# TASK 5 REPORT — Production safety & deployment readiness
Date: 2026-10-10 · Mode: SHADOW/PAPER · Live execution: **never enabled, untouched**

## 1. Commit review + secret scan

| Check | Result |
|---|---|
| Scope `a5b400b` | 11 files, all Task 1–4: `meme-sniper.ts` (+192), `meme-sniper.test.ts` (+66), `sniper-scan.test.ts` (+21), `schema.prisma` (+14), `data/wallet-source/*` (staged), migrations up/down, report doc. No foreign files. |
| Commits ahead of origin | **7**, all sniper/GMGN work except `c726f4c` (stockbit-orderbook, other session) — listed in §2, not individually re-reviewed here. |
| Unstaged (untouched) | `.env.example`, `meme/_shared.tsx`, `meme/risk/content.tsx`, `meme/index.ts`, `meme/types.ts`, `alphio/*` — other session's alphio adapter work. Not absorbed, not committed. |
| Secret scan `origin/main..HEAD` (gitleaks 8.30.1) | **0 leaks, 7 commits scanned** |
| Secret scan `data/wallet-source` (no-git) | **0 leaks** (keys: address, alertsOn, emoji, name, sourceFile; 44-char Solana addresses, no key material) |
| Historical leaks (61, commit 603ecdd Jul, `videos/nexus-promo/build/*`) | Pre-existing, outside push scope, not from Task 1–4 |
| Live secrets on disk | `secrets/staged/` (axiom/solscan cookies + API token, chmod 600, `secrets/` gitignored); `.env` TELEGRAM tokens (gitignored). None printed, none sent to any model. |

**Push:** DONE (`0d87655..a5b400b → main`, verified 0 ahead after).

## 2. Production path evidence (cron → scan → source → evaluator)

- Entry: crontab `*/10 * * * * … npm run cron:sniper` → `tsx src/scripts/sniper-cron.ts` → `runSniperScan` → `toSniperPayload` + `evaluateSniper`. **Single evaluator** (`meme-sniper.ts:evaluateSniper`); `rugcheck/analyzeToken` is a UI safetyScore, not a sniper DECISION. No old evaluator, no fallback, no alternate path in `src`/`scripts`.
- Cron reads **source via tsx** (no build step): HEAD `a5b400b` = fixed code. Runtime log (`/tmp/sniper-cron.log`, fresh 01:10) shows the new shape: `top10HolderPercent, sniperPercent, bundlerSoldPercent, top5AvgPnlPercent` — shaped by the fixed merge.
- Direct UNKNOWN proof on the live modules (9 cases): 8× REJECT incl. null, garbage string, NaN, error-object, empty/malformed topWallets; all-clean → EXECUTE; lock100+error-burn → EXECUTE (exit-safe, documented). **No formatter crash.**
- Schema parity: 6/6 columns in DB + Prisma client (`wallet.findFirst` with all new selects OK).

## 3. Deployment status: **DEPLOYED**

- Pre-deploy: `tsc 0`, full vitest run — 1796/1805 with **1 pre-existing failure**: `deploy-parity.test.ts` (from `f09598d`, not Task 1–4), failing because prod served a stale build — the test *demands* the deploy. It also rebuilt `.next` as a side effect (01:27, gitignored).
- Build check: 1788 server chunks; all 4 fix strings present (`Honeypot status unproven`, `Linked cluster unproven`, `burn unproven`, `Top 1-3 holder identities unproven`).
- Restart: PM2 `1ai-tracker-web` 30 → **31 restarts, unstable 0, uptime 12s→online**.
- Parity (deploy.sh procedure): **js OK + css OK** (md5 served == local).
- Health: `/` → 200; anon `/meme/sniper/*` → 401/“Unauthorized” (contract holds); same-origin GET history → 200, **168 decisions all REJECT**, `executeEnabled: false`, `circuit.locked: false`.
- Parity re-run post-deploy: **PASS**.

## 4. Tests actually run

| Suite | Result |
|---|---|
| Full vitest (pre-deploy) | 1796 pass / 1 pre-existing fail (`deploy-parity`, stale-build demand) / 8 skip |
| `src/lib/modules/derived` | 83/83 |
| Transient T2 matrix (42 rows) | 42/42 final (first 31/42 → exposed malformed bypass, fixed) |
| `tsc --noEmit` | 0 errors (×3 runs) |
| `eslint` on all changed files | 0 errors, 0 warnings (after removing 1 unused var) |
| `npx prisma validate` | schema valid |
| Post-deploy parity test | PASS |
| Direct runtime UNKNOWN matrix (9 cases via `npx tsx`) | 9/9 correct |

## 5. Execution stays disabled

`SNIPER_EXECUTE_ENABLED` **unset** in shell, `.env`, and cron env — evaluator degrades to WATCHLIST. Live `history.executeEnabled: false`. Cron ran with `deliver=true` but every decision REJECTed → `delivered: 0` in every observed run.

## 6. Health check post-deploy

PM2 online, unstable 0; site 200; auth gates deny anonymous; history serves 168 REJECT log; circuit open; no crash in logs; parity PASS.

## 7. Rollback (tested paths, not executed)

- Code: `git revert a5b400b` (single commit) + `scripts/deploy.sh` rebuild→restart→parity; pre-restart snapshot recorded (uptime 3h, restarts 30, unstable 0, HEAD a5b400b).
- DB: `prisma/migrations/add_wallet_operator_columns_20261010/down.sql` (6 `DROP COLUMN IF EXISTS`); no prod data touched by any import (dry-runs only; Wallet count 20787 before and after).
- Rollback **not executed** — no failure observed.

## 8. Wallet permanent-import readiness

- Script: `scripts/import-wallets.ts` + `npm run import:wallets` (dry-run default, `--apply` explicit, single transaction, idempotent upsert on UNIQUE address).
- Dry-run receipts: staged 295 / unique 207 / db-before 20787 / conflicts **20** / nothing written.
- Plan on operator approval: snapshot table counts → `--apply` → verify +207 rows & 20 conflictNotes → re-run idempotency (`INSERT 0`) → keep snapshot 7d.
- **QUALIFIED_SMART_MONEY blocked**: schema comment added on `SmartMoneyWallet` (`PENDING_DEFINITION` until PnL basis incl. fees, win-rate denominator + samples, whale USD threshold are agreed). No PnL/winrate imported or claimed anywhere.

## 9. Remaining blockers

1. Axiom `auth-access-token` expired (425 paths); Solscan free-tier (401 upgrade on meta endpoints, 403 CF on cookie paths) — auth-gated sources still offline for audits.
2. Birdeye audit percentages weaker provenance than rugcheck (RE'd forge `security_details` proven a static 61-row catalog) — EXECUTE-grade claims should require ≥2-source agreement (not enforced).
3. Thresholds (bundler 10/insider 5/sniper 6/vol-ratio/PnL) lack materi quotes; Eksposure-Game bands extracted but not wired.
4. Ticker canonicalization (`$PUPPY` vs `PUPPY`) pending Fase 4.
5. `deploy-parity.test.ts` doubles as a deploy gate but also rebuilds on every suite run — slow side effect worth isolating.
