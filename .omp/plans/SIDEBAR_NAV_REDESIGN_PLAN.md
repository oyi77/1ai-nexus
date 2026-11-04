# Master Execution Plan: Sidebar Navigation Restructuring & Active State Precision Engine

## Problem Statement & Root Cause
1. **Active State False Positives & Prefix Collisions**:
   In `src/components/layout/NexusLayout.tsx`, active matching uses `pathname === item.href || (item.href !== '/' && pathname.startsWith(`${item.href}/`))`.
   - Query strings are completely ignored (`usePathname()` strips them). Routes with tabs like `/signals?tab=alpha` or `/predictions?tab=markets` never activate their specific nav item; the parent path `/signals` or `/predictions` activates instead.
   - Prefix matching greedily activates parent items: navigating to `/meme/sniper` activates both `/meme` and `/meme/sniper`. Navigating to `/compare/tokens` activates both `/compare` and `/compare/tokens`.
2. **Cognitive Overload (107 Flat Items)**:
   `src/lib/config/nav.ts` defines 107 links across 8 sections. The `Markets` section has 28 items in a single uninterrupted column; `On-Chain` has 30 items. Users (especially non-technical / casual users) are overwhelmed by an uncurated wall of metrics and esoteric developer tools.
3. **No Progressive Disclosure (Beginner vs Pro Experience)**:
   A casual user seeking high-conviction signals or simple token screeners must sift through MEV detectors, DCF models, basis arbitrage, and mempool radars. There is no lightweight curated view.

---

## Approach & Ordered Implementation Steps

### Phase 1: Pre-Edit Safety & Design Foundation
1. **Directory & Backups**:
   - Create `backupcode_coding-high/` directory in project root if not present.
   - Create verbatim timestamped backups:
     - `backupcode_coding-high/NexusLayout.tsx_backup_<TIMESTAMP>.tsx`
     - `backupcode_coding-high/nav.ts_backup_<TIMESTAMP>.ts`
2. **Design Specification (Automated Design.md Engine)**:
   - Create temporary `./DESIGN.md` in root with strict zero-slop tokens:
     - Backgrounds: Base `#030712`, Panel `#0B0F17`, Raised `#111827`, Border `#1F2937`
     - Accents: Neon Cyan `#00F0FF` (`text-teal-vivid`, `bg-teal-dim/30`), Border Cyan `#00F0FF`
     - Typography: 11px uppercase tracker headers, 13px nav item links, tabular-nums for counters
     - Segmented Mode Switcher: 28px height, 2px padding, subtle border `#1F2937`
     - Sub-group Headings: 10px uppercase tracking-wider, `text-text-muted/60`, 8px margin-top
     - Invariant: Zero emojis in UI; Lucide vector icons only.

---

### Phase 2: Hermetic Navigation Matcher Engine
1. **Build `src/lib/config/nav-matcher.ts`**:
   - Implement pure deterministic matcher function:
     ```ts
     export function getActiveNavHref(
       allHrefs: string[],
       pathname: string,
       searchParams?: string | URLSearchParams | null,
     ): string | null
     ```
   - **Specificity & Tie-Breaking Algorithm**:
     - Parse every registered `candidateHref` into `candidatePath` and `candidateQuery` (`URLSearchParams`).
     - **Exact Path Match (`candidatePath === pathname`)**:
       - If candidate has query parameters:
         Verify all candidate query key-value pairs match `searchParams`.
         If all match: score = `3000 + (queryCount * 100) + candidateHref.length`.
         If any mismatch: score = `-1` (rejected).
       - If candidate has NO query parameters:
         If current URL also has no query parameters: score = `1500 + candidatePath.length`.
         If current URL has query parameters: score = `1000 + candidatePath.length` (allows exact query candidate to take precedence).
     - **Prefix Path Match (`candidatePath !== '/' && pathname.startsWith(candidatePath + '/')`)**:
       - Candidate has query params: score = `-1` (prefix query matching not allowed).
       - Candidate has no query params: score = `candidatePath.length` (longer path wins: `/meme/sniper` with length 12 strictly beats `/meme` with length 5).
     - Select candidate with `Math.max(score) > 0`. If tied, select longest `href.length`. If no score > 0, return `null`.
2. **Unit Test Suite `src/lib/config/__tests__/nav-matcher.test.ts`**:
   - Cover 10 test scenarios:
     1. Exact match without query: `/dashboard` matches `/dashboard`.
     2. Query parameter priority: `/signals?tab=alpha` matches when search param `tab=alpha` is present, rejecting `/signals`.
     3. Fallback to base path: `/signals?tab=unknown` falls back to `/signals`.
     4. Prefix collision elimination: `/meme/sniper` matches `/meme/sniper`, NEVER `/meme`.
     5. Deep prefix nested matching: `/copy-trading/leader/123` matches `/copy-trading` without activating unrelated sibling routes.
     6. Deep comparison specificity: `/compare/tokens` matches `/compare/tokens`, rejecting `/compare`.
     7. Root path safety: `/` does not greedily match `/anything`.
     8. Multiple query parameters: matches full key-value sets correctly.
     9. Trailing slashes: normalizes `/dashboard/` to `/dashboard`.
     10. Empty or null searchParams handling.

---

### Phase 3: Navigation Schema & Information Architecture Restructuring
1. **Extend Type Contract in `src/lib/config/nav.ts`**:
   ```ts
   export interface NavItem {
     label: string
     href: string
     description?: string
     icon: React.ComponentType<{ size?: number; className?: string }>
     category?: string    // Visual sub-category header (e.g. 'TradFi & Equities')
     isPrimary?: boolean  // Included in 'Simple' (Essential) mode
     badge?: string       // Optional pill tag (e.g. 'HOT', 'NEW', 'PRO', 'ID')
   }
   ```
2. **Categorize the Large Sections (Markets & On-Chain)**:
   - **Markets (28 items) categorized into 4 sub-groups**:
     - `Core & Screeners`: Markets Hub, Screener, Market Overview, Trending, Moonshot Board
     - `Indonesian & Equities`: IDX Saham (`badge: 'ID'`), Equities, Fundamentals, Financials, DCF Model, Comps, Insider, 20Y History
     - `Crypto & Tokens`: Token Intel, Token Discovery, Compare, Token Compare, Charts, Order Book, Heatmap
     - `TradFi & Derivatives`: Commodities, Forex, Bonds, Derivatives, Deriv Intel, Options Chain, Options Intel, ETF, ETF Flows
   - **On-Chain (30 items) categorized into 4 sub-groups**:
     - `Whales & Smart Money`: On-Chain Hub, Smart Money, Whale Clusters, Top Traders, Copy Trading, Copy Performance, Entity Intel, Knowledge Graph
     - `DEX Radar & Scanners`: DEX Monitor, Degen Scanner, Mempool Radar, Live Trades, MEV Detector, Gas Tracker, Token Explorer
     - `DeFi & Yields`: DeFi Hub, Yield Farming, Yield Finder, TVL Dashboard, Protocol Revenue, Stablecoins, Stablecoin Intel, Token Unlocks
     - `Ecosystem & Macro`: On-Chain Intel, Exchange Flow, Sectors, Risk Intel, Dev Activity, Attention Index, Infra Signals
3. **Assign `isPrimary: true` to the Curated 14 Core Essentials**:
   - Dashboard: Overview (`/dashboard`), Watchlist (`/watchlist`), Portfolio (`/portfolio`)
   - Signals: All Signals (`/signals`), AI Signals (`/signals?tab=alpha`), Fear & Greed (`/fear-greed`)
   - Markets: Screener (`/screener`), IDX Saham (`/saham`), Trending (`/trending`)
   - On-Chain: Smart Money (`/smart-money`), Whale Clusters (`/whale-cluster`), Copy Trading (`/copy-trading`)
   - Meme: Sniper (`/meme/sniper`), Risk Audit (`/meme/risk`)
4. **Preserve Compatibility Invariants**:
   - `NAV_SECTIONS` maintains exactly 8 sections (passes `nav.test.ts` limit <= 8).
   - Every route continues to exist on disk (passes `nav.test.ts` file existence check).
   - `NAV_TOP_LEVEL` retains exactly 8 items matching section landing routes.
   - `GlobalSearch.tsx` continues to index every page seamlessly via `section.items`.

---

### Phase 4: NexusLayout.tsx UI/UX Component Overhaul
1. **State & Mode Management**:
   - Read `searchParams` via `useSearchParams()` from `next/navigation`.
   - Maintain `navMode` state (`'simple' | 'pro'`), initialized from `localStorage.getItem('nexus_nav_mode')` (defaulting to `'simple'`).
   - Store user preference in `localStorage` on toggle.
2. **Segmented Mode Switcher (Simple vs Pro)**:
   - Render a sleek 28px segmented pill control right below TopBar inside sidebar header:
     - Left pill: `Simple` (14 essential routes, zero clutter for beginners)
     - Right pill: `Pro` (Full 107 categorized tools with sub-headers)
   - When collapsed (icon-only mode), the switcher neatly auto-hides.
3. **Active State Integration**:
   - Build flat list of all navigable `href`s:
     `const allHrefs = useMemo(() => NAV_SECTIONS.flatMap(s => s.items.map(i => i.href)), [])`
   - Compute `activeHref = getActiveNavHref(allHrefs, pathname, searchParams)`
   - Item active rule: `isActive = item.href === activeHref` (strictly one active item across entire sidebar).
   - Section active rule: `activeInSection = section.items.some(i => i.href === activeHref) || (activeHref === null && (pathname === section.href || pathname.startsWith(`${section.href}/`)))`
   - Auto-expand section containing `activeHref` on navigation.
4. **Sub-Category Visual Hierarchy (Pro Mode)**:
   - Within each expanded section, group consecutive items by `item.category`.
   - If `category` exists and is new: render clean hairline divider and 10px uppercase tracking label.
   - Indent sub-items with crisp 1px hairline border and 2px left-indicator accent on active state.
5. **Badges Rendering**:
   - If `item.badge` exists, render subtle pill on the right:
     - `HOT`: Amber fill (`bg-amber-500/10 text-amber-400 border border-amber-500/20`)
     - `ID`: Teal fill (`bg-teal-500/10 text-teal-400 border border-teal-500/20`)
     - `PRO`: Slate/Indigo fill (`bg-indigo-500/10 text-indigo-400 border border-indigo-500/20`)

---

### Phase 5: Verification, Gate Checks & Cleanup
1. **Automated Test Verification**:
   - `npx vitest run src/lib/config/__tests__/nav-matcher.test.ts` (10/10 tests passing).
   - `npx vitest run src/lib/config/__tests__/nav.test.ts` (6/6 IA invariants passing).
   - `npx tsc --noEmit` (zero TypeScript errors).
2. **Behavioral Proof Scenarios**:
   - Scenario A: URL `/meme/sniper` -> Only `/meme/sniper` has active border/accent; `/meme` is inactive.
   - Scenario B: URL `/signals?tab=alpha` -> Only `/signals?tab=alpha` is active; `/signals` is inactive.
   - Scenario C: Simple Mode toggle -> Renders 14 primary items; Pro Mode toggle -> Renders 107 categorized items.
   - Scenario D: LocalStorage persistence -> Reloading preserves user's chosen mode.
3. **Cleanup**:
   - Remove temporary `./DESIGN.md`.

---

## Critical Files & Anchors
- `src/lib/config/nav-matcher.ts` (New): Pure scoring algorithm resolving exact item active state.
- `src/lib/config/__tests__/nav-matcher.test.ts` (New): Comprehensive unit tests covering path & query specificity.
- `src/lib/config/nav.ts` (Anchor: `NAV_SECTIONS`): Categorized item definitions, `isPrimary` flags, and badges.
- `src/components/layout/NexusLayout.tsx` (Anchor: lines 112-195): Sidebar markup, mode toggle, sub-grouping, active state resolution.
- `src/lib/config/__tests__/nav.test.ts` (Anchor: lines 5-44): Information architecture validation tests.
