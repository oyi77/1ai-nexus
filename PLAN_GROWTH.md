# GROWTH SPRINT — Nexus Terminal

## Goal
4 tracks, parallel, 0 file conflicts. Live-verify before commit.

## Tracks & File Ownership

### Track A: Mobile/PWA (Agent A)
- Make NexusLayout genuinely responsive at 390px (mobile menu, ticker wrap, table horizontal scroll)
- Verify PWA: manifest.json, sw.js, icons, install prompt works
- Files: `src/components/layout/NexusLayout.tsx`, `src/components/layout/TickerStrip.tsx`, `public/manifest.json`

### Track B: Messaging (Agent B)
- Landing page: shift from "38,902 instruments / breadth" to "actionable signals / intelligence / insights"
- STATS section: replace "38,902 instruments" with "50+ proprietary signals" or "AI-powered trade thesis"
- FEATURES section: reframe from "Market data" to "Intelligence" — "Bandarmology signals", "Meme alpha scoring", "Trade thesis", "Smart-money tracking"
- Remove any "no API key required" language (implies public data = no moat)
- COMPARISON table: add "Proprietary Intelligence" column
- Files: `src/app/landing/page.tsx`

### Track C: Sell Loop (Agent C)
- Pricing page: ensure anonymous → signup → purchase path works
- HandlePayment: if checkout 401 → redirect to /signup?redirect=/pricing (not /login which doesn't exist? actually /login does exist)
- After signup, redirect back to /pricing to complete purchase
- Verify the full funnel: anonymous → /pricing → click "Upgrade" → /signup → signup → back to /pricing → purchase
- Files: `src/app/pricing/page.tsx`, `src/app/signup/page.tsx` (ensure redirect param works)

### Track D: Data Depth (Agent D)
- The landing page and /dashboard should surface derived insights as the product, not raw data
- Create a dashboard component that shows: "Today's Trade Thesis", "Top Alpha Signals", "Bandarmology Flow", "Smart Money Moves"
- Put insights front and center
- Files: `src/app/dashboard/page.tsx`, `src/lib/config/nav.ts` (if needed)

## Constraints
- Do NOT mention "RE" or "reverse-engineered" in any public-facing text
- "RE" is internal codebase terminology only
- Positioning: "exclusive intelligence", "proprietary signals", "hard-to-find data"
- Stack: Next.js 16, React 19, TypeScript, Tailwind
- Color tokens: Nexus standard
- Do NOT run tests or build — parent will
- Use Python eval or write for file edits (edit tool mangles files)