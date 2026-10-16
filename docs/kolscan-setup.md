# KOLScan Setup Runbook

## What KOLScan Is

[KOLScan](https://kolscan.io) is a Solana KOL wallet monitoring platform that
publishes a live feed of verified-KOL wallet purchases. It exposes:

1. **KOL wallet roster** — 500+ verified KOL wallets with names, Twitter,
   Telegram, and EVM addresses.
2. **Live transaction feed** — latest KOL buys with wallet address, SOL amount,
   token symbol/address, DEX, and timestamp.

The data is embedded in the homepage's Next.js RSC (React Server Component)
payload. Authentication requires a session cookie (`user-session`).

## Why It Matters

KOLScan is **additive** to the existing GMGN `smart_degen` proxy, which currently
supplies 166 KOL-classifiable wallets (108 `smart_degen` + 58 `kol`). KOLScan
provides verified-human KOL wallets directly — no heuristic filtering required —
and a live transaction feed that the GMGN proxy does not offer.

### Pipeline Integration

| Consumer | Role | Gate |
|---|---|---|
| `cron:kol-monitor` (every 5 min) | Screens live KOL buys against the operator gate, folds unseen buys into `wallet-buys-latest.json`, persists screened wallets to the Wallet table, sends Telegram digest | `KOL_MONITOR_ENABLED` + `KOLSCAN_ENABLED` + `KOLSCAN_SESSION` |
| `harvest:whales` (daily 03:30) | Harvests the KOLScan wallet roster into the Wallet table + Google Sheet | `WHALE_HARVEST_KOLSCAN` (default `true`) + `KOLSCAN_SESSION` |

### Operator Gate (applied by `screenKolscanTransactions`)

1. **Purchase >= $1000** — `solChange x live SOL price` (Jupiter/CoinGecko).
2. **Wallet 30d win rate >= 60%** — cross-referenced with GMGN wallet stats
   (`buildWinRateMap` queries all four GMGN tags: `smart_degen`, `sniper`,
   `kol`, `axiom`).
3. **Coordinated-replica filter** — drops transactions whose exact `outAmount`
   appears in >=3 distinct wallets in the same feed batch (launcher/bot guard).

## Setup Steps

### Step 1 — Obtain the Session Cookie

1. Open [kolscan.io](https://kolscan.io) in a browser (Chrome/Firefox).
2. Log in or create an account.
3. Open **DevTools** (F12 or Ctrl+Shift+I).
4. Go to **Application** -> **Storage** -> **Cookies** -> `https://kolscan.io`.
5. Find the cookie named **`user-session`**.
6. Copy its **Value** (a long opaque string).

### Step 2 — Set Environment Variables

Edit the live `.env` (gitignored):

```bash
# Master gate — enables the entire cron:kol-monitor script
KOL_MONITOR_ENABLED="true"

# KOLScan source gate — enables the KOLScan feed branch
KOLSCAN_ENABLED="true"

# The session cookie value from Step 1
KOLSCAN_SESSION="<paste cookie value here>"
```

> **Note:** The `KOLSCAN_MIN_PURCHASE_USD` and `KOLSCAN_MIN_WINRATE` vars
> documented in `.env.example` are currently NOT read by the code — the
> thresholds are hardcoded in `KOLSCAN_THRESHOLDS` (`minPurchaseUsd: 1000`,
> `minWinRate: 0.6`). Setting them has no effect; they are aspirational knobs.

### Step 3 — Activate the Crons

The `cron:kol-monitor` crontab entry may already be installed. Check:

```bash
crontab -l | grep kol-monitor
```

If not present, add:

```bash
*/5 * * * * cd /home/openclaw/projects/1ai-tracker && PATH=/home/openclaw/.nvm/versions/node/v22.22.3/bin:/usr/bin:/bin npm run cron:kol-monitor >> /tmp/kol-monitor.log 2>&1
```

The `harvest:whales` cron (daily 03:30) already defaults to `WHALE_HARVEST_KOLSCAN="true"`
and will pick up the KOLScan roster automatically once `KOLSCAN_SESSION` is set.

## Verification

After setting the cookie and flipping both gates to `"true"`, run the cron
manually:

```bash
cd /home/openclaw/projects/1ai-tracker && npm run cron:kol-monitor
```

Expected output when the cookie is valid:

```
[kol-monitor] 2026-01-01T00:00:00.000Z — starting
[kol-monitor] KOLScan: 500 wallets, 50 txs
[kol-monitor] GMGN win-rate map: 200 wallets
[kol-monitor] KOLScan screened: 5 txs passed gate
...
[kol-monitor] done: kolscan_screened=5 kolscan_unseen=3 ...
```

If the cookie is invalid or expired, you will see:

```
[kol-monitor] KOLScan: 0 wallets, 0 txs
```

This means `fetchKolscanFeed()` returned an empty feed (the RSC payload had no
wallet rows). Re-obtain the session cookie per Step 1.

## Expected Yield

- **~500 verified KOL wallets** per `harvest:whales` run (additive to the
  existing 166 GMGN `smart_degen`/`kol` wallets).
- **Variable live transactions** per `cron:kol-monitor` run (typically 10-50
  raw txs, ~3-10 passing the $1000 + 60% win-rate gate).

## Fallback

Without the cookie, both consumers are safe no-ops:

- `fetchKolscanFeed()` returns `{ wallets: [], transactions: [], fetchedAt: ... }`
  when `KOLSCAN_SESSION` is empty.
- `kol-monitor-cron.ts` logs `[kol-monitor] disabled (KOL_MONITOR_ENABLED != 'true')`
  and exits 0 when the master gate is off.
- `harvestKolscanWalletsVerified()` returns `kolscanTotal: 0` when the feed is
  empty — the harvester continues with GMGN-only wallets.

The GMGN `smart_degen` proxy (166 wallets) already covers KOL discovery
partially. KOLScan is additive, not blocking.
