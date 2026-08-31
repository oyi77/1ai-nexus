// ─────────────────────────────────────────────────────────────
// Module: Moby (moby.win) — Meme Alpha  [ PENDING API KEY ]
// sourceType: pending
// upstreamProduct: Moby — smart-money meme screener (mobile-first, $MOBY)
// status: DISABLED — endpoints extracted from APK but API requires
//   runtime X-API-KEY provisioned via Privy auth (not in APK).
//
// APK RE FINDINGS (v1.1.17, extracted /tmp/moby-re/base/):
//   Base URL:  https://mobile-api.mobyscreener.com
//   Auth:      X-API-KEY header (runtime-provisioned via Privy)
//   Endpoints (from JS bundle /mobile/api_v1/):
//     - /tokens/screener/leaderboard/?network=
//     - /tokens/screener/groups/?network=
//     - /tokens/screener/launchpads/?network=
//     - /tokens/token/details?token_address=
//     - /tokens/token/chart?token_address=
//     - /tokens/token/holders/list?token_address=
//     - /tokens/whalewatch/follows
//     - /tokens/dca/global?
//     - /tokens/signalsFeed
//     - /tokens/clips/list?network=
//     - /price-alerts/list, /price-alerts/create
//     - /trigger-orders/list, /trigger-orders/create
//     - /watchlist/list, /watchlist/add, /watchlist/remove
//     - /wallet/transactions/list, /wallet/positions/list
//     - /users/pnl-leaderboard/list?window=
//     - /swap/v3/execute, /swap/v3/get-quote
//     - /rewards/transactions, /rewards/claim-code
//
// UNBLOCK PATH:
//   1. Obtain runtime API key via Moby app login (MITM proxy on device)
//      OR find community-leaked key (Telegram/Discord/GitHub).
//   2. Set MOBY_API_KEY env var.
//   3. Implement discoverMobyTokens() / auditMobyToken() using the
//      endpoints above (mirror gate/bitget patterns).
//   4. Flip enabled:true in meme registry, delete this doc block.
// ─────────────────────────────────────────────────────────────

import type { MemeAlphaToken, MemeRiskAudit } from '../types'

class MobyNotImplemented extends Error {
  constructor() {
    super('Moby meme module pending API key — endpoints extracted from APK but X-API-KEY required')
    this.name = 'MobyNotImplemented'
  }
}

async function discoverMobyTokens(): Promise<MemeAlphaToken[]> {
  throw new MobyNotImplemented()
}

async function auditMobyToken(): Promise<MemeRiskAudit | null> {
  throw new MobyNotImplemented()
}

export { discoverMobyTokens, auditMobyToken }
