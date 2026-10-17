# KOLScan Setup Runbook

## What KOLScan Is

[KOLScan](https://kolscan.io) is a Solana KOL wallet monitoring platform that
publishes a live feed of verified-KOL wallet purchases. It exposes:

1. **KOL wallet roster** — 500+ verified KOL wallets with names, Twitter,
   Telegram, and EVM addresses.
2. **Live transaction feed** — latest KOL buys with wallet address, SOL amount,
   token symbol/address, DEX, and timestamp.

The data is embedded in the homepage's Next.js RSC (React Server Component)
payload. No authentication is required: the adapter reads it keylessly. A
`user-session` cookie is optional and is only ever sent as a request header.

## Why It Matters

KOLScan is **additive** to the existing GMGN `smart_degen` proxy, which currently
supplies 166 KOL-classifiable wallets (108 `smart_degen` + 58 `kol`). KOLScan
provides verified-human KOL wallets directly — no heuristic filtering required —
and a live transaction feed that the GMGN proxy does not offer.

### Pipeline Integration

| Consumer | Role | Gate |
|---|---|---|
| `cron:kol-monitor` (every 5 min) | Screens live KOL buys against the operator gate, folds unseen buys into `wallet-buys-latest.json`, persists screened wallets to the Wallet table, sends Telegram digest | `KOL_MONITOR_ENABLED` + `KOLSCAN_ENABLED` (`KOLSCAN_SESSION` optional) |
| `harvest:whales` (daily 03:30) | Harvests the KOLScan wallet roster into the Wallet table + Google Sheet | `WHALE_HARVEST_KOLSCAN` (default `true`); `KOLSCAN_SESSION` optional |

### Operator Gate (applied by `screenKolscanTransactions`)

1. **Purchase >= $1000** — `solChange x live SOL price` (Jupiter/CoinGecko).
2. **Wallet 30d win rate >= 60%** — cross-referenced with GMGN wallet stats
   (`buildWinRateMap` queries all four GMGN tags: `smart_degen`, `sniper`,
   `kol`, `axiom`).
3. **Coordinated-replica filter** — drops transactions whose exact `outAmount`
   appears in >=3 distinct wallets in the same feed batch (launcher/bot guard).

## Setup Steps

### Step 1 — Obtain a Session Cookie (optional)

1. Open [kolscan.io](https://kolscan.io) in a browser (Chrome/Firefox).
2. Log in or create an account.
3. Open **DevTools** (F12 or Ctrl+Shift+I).
4. Go to **Application** -> **Storage** -> **Cookies** -> `https://kolscan.io`.
5. Find the cookie named **`user-session`**.
6. Copy its **Value** (a long opaque string).

> **Optional.** The feed works keylessly: the wallet roster is read from the
> public Supabase REST endpoint and the homepage RSC payload, and
> `evm_address` comes from the SSR HTML. The cookie is only sent as a header
> when set and never gates the feed. Leave `KOLSCAN_SESSION` empty if you do
> not have one.

### Step 2 — Set Environment Variables

Edit the live `.env` (gitignored):

```bash
# Master gate — enables the entire cron:kol-monitor script
KOL_MONITOR_ENABLED="true"

# KOLScan source gate — enables the KOLScan feed branch
KOLSCAN_ENABLED="true"

# OPTIONAL session cookie (sent as a header only; never gates the feed)
KOLSCAN_SESSION=""
```

> **Note:** `KOLSCAN_MIN_PURCHASE_USD` and `KOLSCAN_MIN_WINRATE` **are** read
> by `resolveKolscanThresholds()`: a positive `KOLSCAN_MIN_PURCHASE_USD` and a
> `KOLSCAN_MIN_WINRATE` within `[0, 1]` (including `0`) override the defaults.
> Empty, invalid, or NaN values fall back to `KOLSCAN_THRESHOLDS`
> (`minPurchaseUsd: 1000`, `minWinRate: 0.6`).

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
and picks up the KOLScan roster automatically — no cookie is needed.

## Verification

After flipping both gates to `"true"`, run the cron manually:

```bash
cd /home/openclaw/projects/1ai-tracker && npm run cron:kol-monitor
```

Expected output when either source is reachable:

```
[kol-monitor] 2026-01-01T00:00:00.000Z — starting
[kol-monitor] KOLScan: 500 wallets, 50 txs
[kol-monitor] GMGN win-rate map: 200 wallets
[kol-monitor] KOLScan screened: 5 txs passed gate
...
[kol-monitor] done: kolscan_screened=5 kolscan_unseen=3 ...
```

If **both** sources are unreachable you will see:

```
[kol-monitor] KOLScan: 0 wallets, 0 txs
```

This means `fetchKolscanFeed()` returned an empty feed — BOTH the keyless
Supabase REST path and the kolscan.io RSC HTML scrape yielded nothing. Check
network access to `kolscan.io` and to the Supabase endpoint; the session cookie
is not required, so there is no cookie to re-obtain.

## Expected Yield

- **~500 verified KOL wallets** per `harvest:whales` run (additive to the
  existing 166 GMGN `smart_degen`/`kol` wallets).
- **Variable live transactions** per `cron:kol-monitor` run (typically 10-50
  raw txs, ~3-10 passing the $1000 + 60% win-rate gate).

## Fallback

The module works with zero configuration:

- `fetchKolscanFeed()` reads the keyless Supabase REST roster and the kolscan.io
  RSC payload; it returns `{ wallets: [], transactions: [], fetchedAt: ... }`
  only when BOTH sources yield nothing. An empty `KOLSCAN_SESSION` never
  empties the feed.
- `kol-monitor-cron.ts` logs `[kol-monitor] disabled (KOL_MONITOR_ENABLED != 'true')`
  and exits 0 when the master gate is off.
- `harvestKolscanWalletsVerified()` returns `kolscanTotal: 0` when the feed is
  empty — the harvester continues with GMGN-only wallets.

The GMGN `smart_degen` proxy (166 wallets) already covers KOL discovery
partially. KOLScan is additive, not blocking.

## RE evidence (passive GETs, 2026-10-17)

Passive, read-only reconnaissance — **no auth bypass attempted**; the data is
genuinely public.

| Probe | Result |
|---|---|
| keyless `GET https://kolscan.io/` | 200, ~174 KB, **409 wallets + 10 txs** in the RSC payload, no `Set-Cookie` |
| same GET with a **fake** `user-session` cookie | **byte-identical** response — the cookie gates nothing |
| keyless `https://kolscan-api.pump.fun/api/v1/stream` SSE | 200 (the adapter does **not** use it) |
| keyless Supabase REST `/rest/v1/wallets` (public browser anon key) | 564 rows |
| keyless Supabase REST `/rest/v1/transactions_realtime` | live rows |
| keyless Supabase `/api/v1/wallets` | 405 |

`evm_address` exists **only** in the SSR RSC HTML and is never exposed by the
Supabase `wallets` table — hence the HTML leg is always fetched for enrichment.

