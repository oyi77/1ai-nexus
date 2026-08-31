# DECISION LAYER — Conviction Engine

## Why
Raw data (prices, volumes, funding) exists everywhere for free. Nexus must sell **decisions**, not numbers. Every symbol gets ONE conviction score + action + reasons.

## API Contract: GET /api/v1/conviction

```json
{
  "data": {
    "generated": "2026-08-31T12:00:00.000Z",
    "markets": [
      {
        "id": "IDX",
        "label": "Indonesia Equities",
        "items": [
          {
            "symbol": "BUMI",
            "name": "Bumi Resources Tbk.",
            "price": 194,
            "changePct": 5.43,
            "conviction": 82,
            "action": "BUY",          // BUY | WAIT | SELL
            "direction": "bull",       // bull | bear | neutral
            "reasons": [
              { "text": "Foreign net buy 368.9M shares (est Rp71.6B)", "weight": 0.4 },
              { "text": "Price +5.4% on foreign accumulation", "weight": 0.3 }
            ],
            "sources": ["bandarmology"]
          }
        ]
      },
      {
        "id": "CRYPTO",
        "label": "Crypto",
        "items": [
          {
            "symbol": "BTC",
            "name": "Bitcoin",
            "price": 78752,
            "changePct": -0.5,
            "conviction": 65,
            "action": "BUY",
            "direction": "bull",
            "reasons": [
              { "text": "3 bullish alpha signals (whale inflow)", "weight": 0.5 },
              { "text": "Funding positive", "weight": 0.2 }
            ],
            "sources": ["alpha", "funding", "thesis"]
          }
        ]
      }
    ]
  },
  "error": null
}
```

## Scoring Rules

### IDX (from /api/v1/saham/bandarmology?view=leaders)
- topBuy items: conviction starts 50, +25 if netVol > 0, +15 if changePct > 3, +10 if estNetValueIdr > 1e11
- topSell items: conviction starts 50, -25 if netVol < 0 (reverse sign), action SELL if conviction < 30
- action: conviction >= 65 → BUY, 35-64 → WAIT, < 35 → SELL
- reasons: from netVol direction + changePct + estNetValueIdr

### CRYPTO (from /api/v1/alpha-feed + /api/v1/smart-money + /api/v1/token/thesis)
- Aggregate alpha signals per asset (case-insensitive)
- Each signal: direction (bull=+1, bear=-1, neutral=0) × strength/100 × confidence
- Weight by type: whale=0.35, funding=0.2, smart-money=0.25, liquidation=0.2, news=0.1, default=0.15
- conviction = 50 + (weightedSum × 100), clamped 0-100
- thesis (BULLISH/BEARISH/NEUTRAL) adds ±10, weight 0.3
- reasons: top 3 signals by |weighted contribution|
- action thresholds same as IDX

## Files
- CREATE src/lib/conviction/engine.ts — pure scoring functions (testable, no IO)
- CREATE src/app/api/v1/conviction/route.ts — GET handler, fetches sources, calls engine, returns contract
- CREATE src/app/intelligence/page.tsx — decision-first UI
- MODIFY src/lib/config/nav.ts — add Intelligence nav item

## UI Design (/intelligence)
- Header: "Market Intelligence" + generated timestamp
- Market tabs: All | Indonesia Equities | Crypto
- Cards sorted by conviction desc:
  - Conviction bar (0-100, color: green>=65, amber 35-64, red<35)
  - Action badge (BUY green / WAIT amber / SELL red)
  - Symbol + name + price + changePct
  - Reasons list (bullet + weight dots)
  - Source chips (bandarmology, alpha, funding, thesis, smart-money)
- Mobile: single column, cards stack
- Desktop: 2-column grid
- Empty state: "No signals right now"
