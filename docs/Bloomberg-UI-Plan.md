# Bloomberg-Level Terminal UI Overhaul — Implementation Plan

## Design Principles (from research)

### feremabraz/bloomberg-terminal patterns:
- Single scrollable HTML table — NOT CSS grid
- **px-2 py-1** on every cell (2px horizontal, 4px vertical)
- **text-xs font-mono** globally
- **No borders between cells** — only `border-b` on rows
- Canvas sparklines: **80×20px** — extremely compact
- Progressive column hiding: Time hidden below sm, Ytd below md
- **h-6** on all buttons (24px tall)
- Jotai for atomic state, TanStack Query for data

### SAY-5/sigma-terminal patterns:
- **Raw Canvas 2D** for charts — zero charting libraries
- 5-layer render: background → grid → volume → Bollinger → candles
- Crosshair: dashed lines + OHLCV tooltip on hover
- **15+ indicators** computed client-side (339 lines)
- WebSocket real-time with polling fallback (15s chart, 10s watchlist)
- **Map-based cache** with per-key TTL (quote: 8s, profile: 24h)
- All UI in one file (901 lines) — extreme locality

### Bloomberg Terminal core patterns:
- **4 keystrokes to any function**
- Dense monospace tables, 10-20x more data per screen
- Color-coded: green=bullish, red=bearish, cyan=info, amber=warning
- Keyboard-first: j/k scroll, Tab cycles panels, Enter selects
- Command line always visible
- Multi-monitor native (CSS grid switch only)

---

## Architecture

### Component Structure
```
src/components/terminal/
├── TerminalShell.tsx        ← Full-screen shell (nav + ticker + 3-col)
├── TickerStrip.tsx          ← Scrolling 50+ instrument ticker
├── ContextBar.tsx           ← Market cap, dominance, breadth, clock
├── LiveFeedPanel.tsx        ← Left: color-coded streaming rows
├── MainPanel.tsx            ← Center: 4-quadrant Bloomberg grid
├── AiPanel.tsx              ← Right: AI assistant
├── CommandPalette.tsx       ← / shortcut, fuzzy search
├── charts/
│   ├── CanvasChart.tsx      ← Raw Canvas 2D candlestick renderer
│   ├── Sparkline.tsx        ← 80×20px inline sparklines
│   └── Indicators.ts        ← SMA, EMA, RSI, MACD, BB (client-side)
├── tables/
│   ├── DenseTable.tsx       ← Bloomberg-style dense table component
│   └── MarketRow.tsx        ← Single row with sparkline + color coding
└── panels/
    ├── QuotesPanel.tsx      ← Top-left: market quotes table
    ├── ChartPanel.tsx       ← Top-right: candlestick + indicators
    ├── NewsPanel.tsx        ← Bottom-left: sentiment-scored news
    └── DeFiPanel.tsx        ← Bottom-right: TVL + yields table
```

### Layout (CSS Grid, NOT flexbox)
```
┌─────────────────────────────────────────────────────────────┐
│ ▦ NEXUS  [1:TERMINAL] [2:MARKET] ...     ⚙ MODULES  ⌘K    │ ← Nav (32px)
├─────────────────────────────────────────────────────────────┤
│ BTC $63,119 ▲0.5% ETH $1,704 ▲0.0% SOL $69 ▼0.6% ...     │ ← Ticker (28px)
├─────────────────────────────────────────────────────────────┤
│ FG:14 Fear│MCap:$2.4T│BTC.D:52%│Vol:$89B│14:23:07         │ ← Context (24px)
├──────────────┬──────────────────────────────────────────────┤
│ LIVE FEED    │  OVERVIEW │ CHART │ TABLE │ RAW              │ ← Tabs (28px)
│              │                                              │
│ 14:23 🐋 ... │ ┌─────────────────┬──────────────────────┐  │
│ 14:22 📰 ... │ │ MARKET QUOTES   │ CANDLESTICK CHART   │  │ ← 4-quadrant
│ 14:21 📊 ... │ │ BTC  $63,119    │ ┌──────────────────┐ │  │    grid
│ 14:20 🔥 ... │ │ ETH  $1,704     │ │  ╱╲   ╱╲         │ │  │
│ 14:19 🤖 ... │ │ SOL  $69.06     │ │ ╱  ╲ ╱  ╲  ╱╲   │ │  │
│              │ │ BNB  $580.31    │ │╱    ╲╱    ╲╱  ╲  │ │  │
│              │ │ ... (20+ rows)  │ │               ╲  │ │  │
│              │ ├─────────────────┤ └──────────────────┘ │  │
│              │ │ LIVE NEWS       │ DEFI PROTOCOLS       │  │
│              │ │ 📰 headline...  │ 1. Binance $137B     │  │
│              │ │ 📰 headline...  │ 2. Lido $15.3B       │  │
│              │ └─────────────────┴──────────────────────┘  │
├──────────────┴──────────────────────────────────────────────┤
│ NEXUS AI ▸  [Ask about market data...]          [SEND]     │ ← AI (200px)
└─────────────────────────────────────────────────────────────┘
```

### Density Targets
| Element | Padding | Font | Lines per row |
|---------|---------|------|---------------|
| Table cell | px-2 py-0.5 | text-[11px] font-mono | 1 |
| Nav button | px-2 py-1 | text-[10px] font-mono | 1 |
| Feed row | px-2 py-1 | text-[11px] | 1-2 |
| Ticker item | mr-4 | text-[10px] font-mono | 1 |
| Context bar | px-3 py-0.5 | text-[10px] font-mono | 1 |
| Chart | 0 padding | — | 200px height |
| Sparkline | 80×20px | — | inline |

---

## Phase 1: Canvas Charts (Day 1)

### CanvasChart.tsx
- Raw Canvas 2D, no charting library
- 5-layer render: background → grid → volume → Bollinger → candles
- Crosshair: dashed lines + OHLCV tooltip on hover
- Coordinate mapping: toX(i) = pad.l + i * barW, toY(p) = pad.t + ch * (1 - (p - lo) / (hi - lo))
- Auto-resize: count = Math.min(data.length, Math.floor(cw / 5))
- Price padding: 6% above/below range

### Sparkline.tsx
- 80×20px Canvas inline sparkline
- Green if last > first, red if last < first
- Used in market quotes table

### Indicators.ts
- SMA, EMA, RSI, MACD, Bollinger Bands
- Pure math, 100 lines, client-side
- Returns same-length arrays with null for insufficient data

---

## Phase 2: Dense Tables (Day 1-2)

### DenseTable.tsx
- Bloomberg-style table component
- 10+ columns: Symbol, Price, Chg%, Volume, Market Cap, Sparkline, 24h High, 24h Low, Bid, Ask
- px-2 py-0.5 on every cell
- border-b border-[#1c2430] on rows only
- Sticky left column for symbol
- Color coding: green=positive, red=negative, cyan=neutral

### MarketRow.tsx
- Single row with inline sparkline
- Hover: bg-[#131920]
- Click: expand to show full token detail

---

## Phase 3: Terminal Layout Overhaul (Day 2)

### TerminalShell.tsx
- CSS Grid: nav(32px) / ticker(28px) / context(24px) / main(1fr) / ai(200px)
- h-screen overflow-hidden — no scrolling on shell
- Each panel scrolls independently

### TickerStrip.tsx
- 50+ instruments scrolling
- WebSocket when available, REST fallback
- BTC, ETH, SOL, BNB, XRP, ADA, AVAX, DOGE, DOT, LINK, UNI, AAVE, GOLD, DXY, SPX

### ContextBar.tsx
- Fear/Greed, Market Cap, BTC Dominance, 24h Volume, Active Alerts, Clock
- All in one row, text-[10px] font-mono

---

## Phase 4: Keyboard Navigation (Day 2)

### KeyboardShortcuts.tsx
- Global keydown listener (null-rendering component)
- `/` → command palette
- `1-8` → switch panels
- `j/k` → scroll up/down
- `Tab/Shift+Tab` → cycle focus between panels
- `Enter` → select/expand
- `Esc` → close modal/back
- `?` → toggle help overlay

### CommandPalette.tsx
- cmdk library
- `/wallet 0x...` → open wallet view
- `/token ETH` → open token view
- `/macro CPI` → macro data view
- `/news bitcoin` → filter news
- `/module status` → module health

---

## Phase 5: Real-time Data (Day 3)

### WebSocket integration
- Binance WebSocket for real-time prices
- Fallback to REST polling (15s)
- Map-based cache with per-key TTL

### LiveFeedPanel
- Color-coded rows: whale=amber, news=cyan, macro=amber, signal=purple
- Auto-scroll with new items
- Click → expand in main panel

---

## Implementation Order

1. **CanvasChart.tsx** — Raw Canvas candlestick renderer
2. **Sparkline.tsx** — 80×20px inline sparklines
3. **Indicators.ts** — SMA, EMA, RSI, MACD, BB
4. **DenseTable.tsx** — Bloomberg-style table component
5. **TerminalShell.tsx** — CSS Grid layout overhaul
6. **TickerStrip.tsx** — 50+ instrument scrolling ticker
7. **ContextBar.tsx** — Market stats one-liner
8. **LiveFeedPanel.tsx** — Color-coded streaming feed
9. **MainPanel.tsx** — 4-quadrant Bloomberg grid
10. **CommandPalette.tsx** — cmdk integration
11. **KeyboardShortcuts.tsx** — Global keyboard nav
12. **Wire everything to real data**

---

## Files to Create/Modify

| File | Action | Lines (est) |
|------|--------|-------------|
| `src/components/terminal/charts/CanvasChart.tsx` | Create | 200 |
| `src/components/terminal/charts/Sparkline.tsx` | Create | 60 |
| `src/components/terminal/charts/Indicators.ts` | Create | 150 |
| `src/components/terminal/tables/DenseTable.tsx` | Create | 150 |
| `src/components/terminal/tables/MarketRow.tsx` | Create | 80 |
| `src/components/terminal/TerminalShell.tsx` | Rewrite | 100 |
| `src/components/terminal/TickerStrip.tsx` | Rewrite | 120 |
| `src/components/terminal/ContextBar.tsx` | Create | 60 |
| `src/components/terminal/LiveFeedPanel.tsx` | Rewrite | 150 |
| `src/components/terminal/MainPanel.tsx` | Create | 200 |
| `src/components/terminal/CommandPalette.tsx` | Create | 100 |
| `src/components/terminal/KeyboardShortcuts.tsx` | Create | 80 |
| `src/app/page.tsx` | Rewrite | 50 |
| `src/app/globals.css` | Update | 80 |
| **Total** | | **~1,580** |
