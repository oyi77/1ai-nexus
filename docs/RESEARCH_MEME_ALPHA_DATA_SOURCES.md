# Meme Alpha — Data Source Research Findings

> Generated: 2026-08-30
> Context: Evaluating external data sources for the Meme Alpha Terminal
> (Solana-first memecoin intelligence platform) inside 1ai-tracker (nexus).
> Constraint: **0 API key** — only public/internal web APIs that work
> server-side without registration.
> Method: browser RE (Playwright request capture) + direct curl probes.

---

## 1. Birdeye Forge API (ZERO-KEY) ⭐ PRIMARY

**Base URL**: `https://birdeye.so/forge/solana/`
**Auth**: None. Uses the same internal API that the birdeye.so frontend calls.
**Transport**: `fetch` / `curl` with standard `User-Agent` header — Cloudflare
does not block server-side requests (verified: 10 rapid requests all 200).
**Rate limit**: None observed (10 rapid, concurrent requests all 200).
**Chain**: Solana only (forge API is Solana-specific).
**Discovered via**: browser RE — captured forge calls while visiting
find-gems / new-listings / supercharts pages.

### 1.1 Discovery — Gems

```
POST /v3/gems
Content-Type: application/json
Body: { "type":"trending", "sort_by":"rank", "sort_type":"asc",
       "offset":0, "limit":50, "shown_time_frame":"24h" }
```

**`type`** values: `trending`, `topGainers`, `topLosers`, `highestVolume`, `mostVisited`
**`sort_by`** values: `rank`, `price`, `tf1h.priceChangePercent`, `tf4h.priceChangePercent`,
`tf24h.priceChangePercent`, `mc`, `fdmc`, `liquidity`, `tf1h.volumeUSD`,
`tf4h.volumeUSD`, `tf24h.volumeUSD`, `tf1h.volumeChangePercent`,
`tf4h.volumeChangePercent`, `tf24h.volumeChangePercent`, `tf1h.tradeCount`,
`tf4h.tradeCount`, `tf24h.tradeCount`, `tf1h.uniqueWallets`, `tf4h.uniqueWallets`,
`tf24h.uniqueWallets`
**`shown_time_frame`**: `1h`, `4h`, `24h`

**Response shape** (per item):
```typescript
{
  symbol: string
  address: string
  name: string
  network: "solana"
  liquidity: number            // USD
  price: number
  mc: number                   // market cap
  fdmc: number                 // fully diluted market cap
  supply: number               // total supply
  circulatingSupply: number
  holderCount: number
  top10HolderPercent: number   // 🎯 critical for rug detection
  createdAt: number            // epoch ms
  marketCount: number
  rank: number
  birdeyeStrict: boolean
  jupStrict: boolean
  logoURI: string
  extensions: { twitter?, website?, telegram?, discord?, coingeckoId? }
  tf24h: {                     // 24h window
    tradeCount: number
    tradeCountChangePercent: number
    volumeUSD: number
    volumeChangePercent: number
    uniqueWallets: number
    priceChangePercent: number
  }
  tf4h: { ... }                // same shape as tf24h
  tf1h: { ... }                // same shape
}
```

| Normalizes to `MemeAlphaToken` field | Source |
|---|---|
| `id` | `network:contract` |
| `chain` | `"solana"` |
| `contract` | `address` |
| `symbol` | `symbol` |
| `name` | `name` |
| `price` | `price` |
| `change24h` | `tf24h.priceChangePercent / 100` |
| `volume24h` | `tf24h.volumeUSD` |
| `marketCap` | `mc` |
| `liquidity` | `liquidity` |
| `createdAt` | `createdAt` |
| `riskLevel` | computed from `top10HolderPercent` + security |
| `holders` | `holderCount` |
| `top10HolderPercent` | `top10HolderPercent` |
| `social` | `extensions` |
| `audited` | `birdeyeStrict` |

### 1.2 Security / Rug Audit

```
GET /token/security_details?token=<address>&group_by=severity
```

**Response**: groups by severity with per-issue details:
```typescript
{
  groups: [{
    name: "Critical" | "High" | "Medium" | "Low" | "Info"
    rows: [{
      id: string
      severity: number  // 5=Critical, 4=High, 3=Medium, 2=Low, 1=Info
      name: string
      type: string
      tooltip: string
    }]
  }]
}
```

Known issue `id` values: `airdrop_scam`, `fake_token`, `honeypot`,
`owner_change_balance`, `mutability`, `transfer_restriction`, `freeze_risk`,
`mint_authority`, `top10_holder` (and many more).

**Verified status**: works server-side with `User-Agent` + `Referer`
(`https://birdeye.so/`) headers. `total_security_issues` returns
`{ data: { total: N } }` — cheap pre-audit signal.

```
GET /token/total_security_issues?token=<address>
```
**Response**: `{ data: { total: number } }` — quick risk indicator.

```
GET /overview/audit?address=<address>
```
On-chain holder analysis:
```typescript
{
  smart_money: { balance: number, wallets: number, percentage: number }
  dev:           { balance: number, wallets: number, percentage: number }
  top10Holders:  { balance: number, wallets: number, percentage: number }
  snipper:       { balance: number, wallets: number, percentage: number }
  bundler:       { balance: number, wallets: number, percentage: number }
  insider:       { balance: number, wallets: number, percentage: number }
}
```

### 1.3 Token Overview & Stats

```
GET /overview/token?address=<address>
```
Token metadata: `_id`, `address`, `createdAt`, `decimals`, `extensions`,
`holder`, `liquidity`, `logoURI`, `history24hPrice`.

```
GET /overview/token_stats?address=<address>&time_frame=24h
```
Market stats: `price`, `markets`, `holder`, `supply`, `fdv`,
`circulatingSupply`, `mc`, `priceChange.5m/30m/1h/2h/4h/8h/24h`,
`uniqueTraders`, `trade`, `sell`, `buy`, `v`, `vBuy`, `vSell`, `vUSD`,
`vBuyUSD`, `vSellUSD`, `volume`, `volumeUSD`, `tradeCount`.

```
GET /overview/token_verified?address=<address>
```
`{ jupiterVerified: boolean, birdeyeVerified: boolean }`

### 1.4 Holders

```
GET /token/total_holder?address=<address>
```
`{ data: { total: number } }`

```
GET /token/holders?token=<address>&limit=20&offset=0
```
Top holder list: `{ data: { result: [{ address, amount, ... }] } }`
**Verified**: `token=` param (NOT `address=`).

### 1.5 Markets

```
GET /amm/market_lite?address=<address>&sort_by=volume24h&sort_type=desc
```
Active markets for a token: `items[]` with `{address, liquidity, name,
source, volume24h}`.

### 1.6 New Listings

```
POST /new_listing_v2
Content-Type: application/json
Body: { "limit": 50 }
```
**Verified status**: returns 500 for all tested bodies (`{limit}`,
`{page}`, `{page,limit,offset}`, `{}`) — requires deeper RE (likely custom
headers/cookies). Not needed: `/v3/gems` covers discovery.
Alternative: use `GET /new_listing_v2/platforms` and
`GET /new_listing_v2/quote_tokens` for metadata.

```
GET /new_listing_v2/platforms
```
Launchpad platforms: `[{ displayName, name, logoURI, isLaunchpad,
totalToken, totalTokensLast3Days }]`

### 1.7 Wallet / Account

```
GET /account?address=<address>
```
Account info (returns 404 for pump.fun tokens).

### 1.8 Charts (OHLCV + Technicals)

```
GET /amm/ohlcv_v2?addr=<address>&cur=usd&res=4H&outliers=true&cb=300
GET /charts/v2/technicals?addr=<address>&indi=<indicator>&res=4H&cb=310
```

### 1.9 Multi-chain

```
GET /forge/multichain/amm/all
```
All supported AMM providers across chains.

### 1.10 RPC Proxy

```
POST /forge/solana/rpc
```
Solana RPC proxy (pass-through to node).

---

## 2. RugCheck.xyz API (ZERO-KEY) ⭐ COMPLEMENTARY

**Base URL**: `https://api.rugcheck.xyz/v1/tokens/`
**Auth**: None.
**Rate limit**: Unverified, but industry standard ~60 req/min.
**Chain**: Solana (primarily).

### Endpoint

```
GET /v1/tokens/{address}/report
```

**Response**:
```typescript
{
  mint: string
  tokenProgram: string
  creator: string
  creatorBalance: number
  tokenMeta: { name, symbol, uri, mutable, updateAuthority }
  score: number          // 0-100 (0 = safe, higher = riskier)
  risk: string | null
  topHolders: [{ address, pct, balance, owner }]  // top holders
  freezeAuthority: string | null
  mintAuthority: string | null
  risks: [{ name, value, description, score }]     // risk flags
  score_normalised: number
  lockerOwners: [{ address, balance }]
  lockers: [{ ... }]
  lockerScanStatus: string
  markets: [{ ... }]     // market info
  totalMarketLiquidity: number
  totalStableLiquidity: number
  totalLPProviders: number
  totalHolders: number
  price: number
  rugged: boolean
  tokenType: string
  transferFee: { ... }
  knownAccounts: [{ ... }]
  verification: { ... }
  validation: { ... }
  graphInsidersDetected: boolean
  insiderNetworks: [{ ... }]
  detectedAt: string
  creatorTokens: [{ ... }]
  launchpad: { ... }
  deployPlatform: string
}
```

**Mapping to `MemeRiskAudit`**:
| Field | Source |
|---|---|
| `riskLevel` | computed from `score` (0-25→LOW, 25-50→MEDIUM, 50-75→HIGH, 75-100→CRITICAL) |
| `flags` | `risks[].name` + `rugged` |
| `holders` | `totalHolders` |
| `top10HolderPercent` | computed from `topHolders[0..9].pct` |
| `liquidity` | `totalMarketLiquidity` + `totalStableLiquidity` |
| `insiderDetected` | `graphInsidersDetected` |
| `mintAuthority` | `mintAuthority` |
| `freezeAuthority` | `freezeAuthority` |

---

## 3. GMGN Web API (PARTIAL — BROWSER-SESSION-GATED)

**Base URL**: `https://gmgn.ai/api/v1/`
**Auth**: Query params `device_id=...&fp_did=...&client_id=gmgn_web` — works
in browser, but token list endpoints return 403 (Cloudflare challenge) from
server-side curl.

### Endpoints that work server-side

| Endpoint | Response | Value |
|---|---|---|
| `GET /mrwapi/v1/timestamp` | `{ data: { timestamp: number } }` | Nil (just timestamp) |
| `POST /api/v1/major_coin_prices` | BTC/SOL/BNB/ETH prices | Low (already have from other sources) |
| `GET /api/v1/gas_price_list` | Gas prices per chain | Low for memecoin thesis |

### Endpoints that need browser session

| Endpoint | Returns 403 server-side |
|---|---|
| `api/v1/explore` | Token list |
| `api/v1/token_rank` | Rankings |
| `api/v1/rank/sol` | Rankings |
| `api/v1/tokens/rank` | Rankings |
| `api/v1/sol/trending` | Trending |
| `api/v1/token_meta/*`, `api/v1/wallet_rank`, `api/v1/pnl_rank`, `api/v1/new_pairs` | 403 Cloudflare challenge |

**Verdict**: Not worth building a full adapter. The aggregation data
(`dex_trades_polling`) is low-value. The actual token list is gated to
browser sessions. Birdeye forge + RugCheck already cover the gap.

---

## 4. Fomo Family (BLOCKED)

**Base URL**: `https://prod-api.fomo.family`
**Auth**: Returns 430 "unauthorized" — Cloudflare session-based.
**Bundle analysis**: only telemetry endpoints found (`app-actions.fomo.family/e/`,
`/flags/`, `/i/v0/e/`); token data is server-rendered or WebSocket-gated.
**Status**: Same class as Moby / BotX — blocked server-side without
a browser session. Not worth pursuing until a session capture mechanism
is available.

---

## 5. GeckoTerminal API (ZERO-KEY) ✅ NEW

**Base URL**: `https://api.geckoterminal.com/api/v2/`
**Auth**: None. Public API.
**Rate limit**: ~30 calls/min (429 observed on rapid calls).
**Chain**: Solana (multi-chain supported).

### Endpoints

```
GET /networks/solana/trending_pools?page=1
GET /networks/solana/new_pools?page=1
```

**Response** (pool object):
```typescript
{
  id: "solana_<poolAddress>"
  type: "pool"
  attributes: {
    base_token_price_usd: string
    base_token_price_native_currency: string
    address: string
    name: "TOKEN / SOL"
    pool_created_at: string      // ISO
    fdv_usd: string
    market_cap_usd: string
    price_change_percentage: {   // all windows
      m5, m15, m30, h1, h6, h24: string
    }
    transactions: {
      m5, m15, m30, h1, h6, h24: {
        buys, sells, buyers, sellers: number
      }
    }
    volume_usd: string
    reserve_in_usd: string
  }
  relationships: {
    base_token: { data: { id: "solana_<tokenAddress>", type: "token" } }
    quote_token: { data: { ... } }
    dex: { data: { ... } }
  }
}
```

**Key strength**: multi-window price change + buy/sell transaction detail
per window (5m/15m/30m/1h/6h/24h) + fdv + market cap + reserve + token
address in relationships.

| Normalizes to `MemeAlphaToken` | Source |
|---|---|
| `id` | `solana:<tokenAddress>` |
| `chain` | `"solana"` |
| `contract` | `relationships.base_token.data.id.split('_')[1]` |
| `price` | `attributes.base_token_price_usd` |
| `change24h` | `attributes.price_change_percentage.h24 / 100` |
| `volume24h` | `attributes.volume_usd` |
| `marketCap` | `attributes.market_cap_usd` |
| `liquidity` | `attributes.reserve_in_usd` |
| `createdAt` | `attributes.pool_created_at` |

---

## 6. CoinGecko API (ZERO-KEY, rate-limited) ✅

**Base URL**: `https://api.coingecko.com/api/v3/`
**Auth**: None (free tier). Rate limit aggressive (~429 after 3 rapid).
**Chain**: Multi-chain.

### Endpoint

```
GET /coins/markets?vs_currency=usd&category=meme-token&per_page=50&order=market_cap_desc
```

**Response** (per coin):
```typescript
{
  id, symbol, name, image,
  current_price, market_cap, market_cap_rank,
  fully_diluted_valuation, total_volume,
  high_24h, low_24h, price_change_24h, price_change_percentage_24h,
  circulating_supply, total_supply, max_supply,
  ath, ath_change_percentage, ath_date,
  atl, atl_change_percentage, atl_date,
  last_updated
}
```

**Verdict**: Good for established memecoin market context (top-100 ranked),
NOT for new-token discovery. Low priority — Birdeye forge covers the same
data with more freshness.

---

## 7. DexScreener Token Profiles (ZERO-KEY) ✅

**Base URL**: `https://api.dexscreener.com/token-profiles/`
**Auth**: None.

### Endpoint

```
GET /latest/v1
```

**Response** (per profile):
```typescript
{
  url: string
  chainId: string
  tokenAddress: string
  icon, header, openGraph, description, links, cto
}
```

**Verdict**: New token profile announcements (useful for social metadata),
no market data. Low priority for core screens — market data comes from
Birdeye/GeckoTerminal.

---

## 8. Additional Probes (RESULTS)

| Source | Endpoint tested | Result |
|---|---|---|
| Jupiter | `api.jup.ag/*` (7 paths) | 404 all — API not at this host |
| Pump.fun | `/`, `/api/tokens`, `/api/coins` | SPA shell, no clean API |
| Raydium | `api-v3.raydium.io/main/*` (13 paths) | Only `/main/info` (volume24/TVL) works — low value |
| Meteora | `dlmm-api.meteora.ag/*` | 404 all |
| Photon | `photon-sol.tinyastro.io` | Cloudflare JS challenge (403) |
| DefiLlama | `api.llama.fi/overview/tokens` | 500 |
| GMGN | `gmgn.ai/api/v1/*` (13 paths) | 403 Cloudflare challenge on token data; only aggregation works server-side |

---

## 9. Existing Repo Meme Modules (REFERENCE)

### Current zero-key sources

| Platform | Discovery | Audit | Auth |
|---|---|---|---|
| DEX Screener | ✅ `GET /latest/dex/trending/solana` | — | public API, 60 req/min |
| Bitget Wallet | ✅ `POST /market/v3/topRank` | ✅ `POST /market/v3/riskCheck` | static SHA256 token |
| Gate.io DEX | ✅ `POST /api/v4/dex/token_list` | various | public AK/SK |
| BotX | ✅ `POST /kline/new` | `GET /kline/pair_info` | x-api-key (free tier) |
| Moby | — (pending) | — | Cloudflare-blocked |

### Registry pattern

`MEME_REGISTRY` in `src/lib/modules/meme/index.ts` — `DataModule` interface
with `fetch()` + TTL. Routes enumerate registry, no route edits needed when
adding a new platform.

### Shared types

- `MemeAlphaToken` — discovery row (id, platform, chain, contract, symbol,
  price, change24h, volume24h, marketCap, liquidity, createdAt, riskLevel,
  holders, top10HolderPercent, social, audited)
- `MemeRiskAudit` — risk row (platform, chain, contract, riskLevel, flags,
  holders, top10HolderPercent, ...)

---

## 10. Recommended Plan (Enhanced — all findings)

### Phase 1 — Birdeye Forge Adapter (0-key, richest data) ⭐

**Adapter file**: `src/lib/modules/meme/birdeye/index.ts`
**Platform name**: `'birdeye'`

| Function | Endpoint | Purpose |
|---|---|---|
| `discoverBirdeyeTokens()` | `POST /v3/gems` | Discovery feed — `MemeAlphaToken[]` |
| `auditBirdeyeToken(chain, contract)` | `GET /token/security_details` + `GET /overview/audit` | Risk audit — `MemeRiskAudit` |
| `getTokenHolders()` | `GET /token/total_holder` + `GET /token/holders?token=` | Holder count + top holders |
| `getTokenOverview()` | `GET /overview/token` | Token metadata |

**Key fields only available from Birdeye (not existing sources):**
- `top10HolderPercent` (from gems endpoint) — already in `MemeAlphaToken` type
- `holderCount` (from gems) — already in type
- `security_details` with severity groups (honeypot, fake_token, mint_authority, etc.)
- `overview/audit` with smart_money/dev/snipper/bundler/insider balances
- `tf24h.uniqueWallets` — trader velocity
- `birdeyeStrict` / `jupStrict` — verified flags
- `token/holders` top-holder list for forensic depth

**Transport**: `fetch` (no CF block, no TLS fingerprint issue).
**Headers**: `User-Agent` + `Content-Type: application/json`.
**Rate limit**: None observed, but start with conservative 1s backoff.
**Config**: None needed (0-key ✅).

### Phase 2 — RugCheck.xyz Adapter (0-key, security complement)

**Adapter file**: `src/lib/modules/meme/rugcheck/index.ts`
**Platform name**: `'rugcheck'`

**Function**: `auditRugcheckToken(chain, contract)` → `MemeRiskAudit`
**Endpoint**: `GET /v1/tokens/{address}/report`
**Audit only** (no discovery endpoint — Birdeye covers discovery).

### Phase 3 — GeckoTerminal Adapter (0-key, discovery breadth) ⭐ NEW

**Adapter file**: `src/lib/modules/meme/geckoterminal/index.ts`
**Platform name**: `'geckoterminal'`

**Function**: `discoverGeckoTerminalTokens()` → `MemeAlphaToken[]`
**Endpoint**: `GET /networks/solana/trending_pools` + `new_pools`
**Strength**: buy/sell detail per window (5m/15m/30m/1h/6h/24h) + reserve +
fdv — complements Birdeye gems (which lacks per-window buy/sell split).

### Phase 4 — Explainable Score Engine (enhance ranking.ts)

Combine Birdeye data (security, top10Holder, smart_money, volume) + RugCheck
(score, risks, insider) + GeckoTerminal (buy/sell flow) + existing Bitget/Gate
audit data into `scoreOf()` with reason codes — per the Meme Alpha Terminal
spec.

### Phase 5 — Blocked Sources (interface + mock, enabled:false)

| Source | Reason | Doc |
|---|---|---|
| GMGN token list | 403 Cloudflare challenge, browser session needed | `gmgn.ai/api/v1/*` params `device_id` |
| Fomo Family | 430 unauthorized, Cloudflare session | `prod-api.fomo.family` |
| Moby | Cloudflare TLS fingerprint | Documented in memory |
| Photon | Cloudflare JS challenge | `photon-sol.tinyastro.io` |

---

## 11. Key Decisions

1. **Birdeye forge API is the single richest zero-key source** — discovery,
   security, holders, wallet intel in one adapter. Build first.
2. **RugCheck is complementary** — adds `score` + `risks[]` + `insiderNetworks`
   + `lockers` detail that Birdeye doesn't have. Build second.
3. **GeckoTerminal adds discovery breadth** — per-window buy/sell split +
   new_pools feed that Birdeye gems lacks. Build third.
4. **CoinGecko + DexScreener profiles** are low priority — established-market
   context and social metadata only; Birdeye covers the same market data.
5. **GMGN / Fomo / Moby / Photon** are browser-session-gated or
   Cloudflare-challenged; not worth the RE effort when Birdeye + RugCheck +
   GeckoTerminal cover the data. Interface + mock + doc as blocked.
6. **No API key needed for any of the above** — fully satisfies the
   "0 apikey" constraint.
7. **Existing MEME_REGISTRY pattern** is the right home — no route edits needed.