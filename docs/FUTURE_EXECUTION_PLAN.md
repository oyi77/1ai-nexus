# 1ai-tracker — Future Execution Plan

> Derived from the full live audit (122 pages, 187 API routes) and the defect
> patterns that actually bit. Organized by urgency.

---

## 1. Immediate Hardening (do next)

These are the latent defects the audit found waiting to happen.

### 1.1 Audit the remaining "degrade" envelopes
Five routes return `{data:null, error:null}` — `/health`, `/feed`, `/meme/leaderboard`,
`/modules`, `/smart-money/flow`. Confirm each is *intentionally* empty vs. a swallowed
error. If intentional, document it in the route's JSDoc so the next person doesn't
"fix" it.

### 1.2 Harden every fear-greed consumer
The crash came from one unguarded `d.composite.score`. Audit every consumer of
`/api/v1/fear-greed` (page, gauge, macro content, ticker strip, telegram bot) and
make each tolerate a partial payload. The API now returns 502 + `data:null` on
upstream failure — every consumer must handle `data:null` without crashing.

### 1.3 Add a regression test for the deploy-parity hazard
The build-before-restart ordering mistake cost real debugging time. Add a CI step
or pre-deploy checklist item: "served chunk md5 == local build chunk md5." The
`scripts/qa-browser-sweep.mjs` already captures console errors; extend it to also
verify a known chunk hash.

---

## 1. Immediate Hardening ✅

### 1.1 Audit the remaining "degrade" envelopes ✅
Five routes return `{data:null, error:null}` — confirmed intentional null-payload responses.

### 1.2 Harden every fear-greed consumer ✅
All 8 consumers already guarded (fixed in prior session).

### 1.3 Add a regression test for the deploy-parity hazard ✅
`src/lib/modules/__tests__/deploy-parity.test.ts` builds, fetches a served chunk, asserts md5 matches.


The audit found 27/62 feeds dead and both `/mev` upstreams dead. Feeds rot
continuously — this will happen again.

### 2.1 Automated feed health cron
Add a daily cron that:
- Fetches every configured RSS feed
- Records: HTTP status, item count, markup-leak check
- Alerts (Telegram) when a feed that was working returns 0 items or 4xx
- Stores a rolling health log in SQLite

The probe logic already exists in `scripts/_feedcheck.mjs` (throwaway). Promote it
to `scripts/feed-health-check.ts` and wire it into the cron scheduler.

### 2.2 Upstream API health dashboard
The `/api/v1/*` routes that call external APIs (CoinGecko, Binance, DexScreener,
etc.) should expose a `/api/v1/status` or `/api/v1/health/detailed` endpoint that
reports per-upstream latency and last-success. The audit had to probe these
manually — make it self-service.

### 2.3 Feed URL rotation
When a feed dies, the fix is currently manual (probe → find replacement → edit
`engine.ts` → deploy). Build a small admin surface or config-driven feed list so
dead feeds can be swapped without a code change. Consider moving `FEEDS` to a
DB table or JSON file that can be hot-reloaded.

---

## 3. Test Integrity (this month)

The duplicate-helper anti-pattern in `rss-parser.test.ts` is the most dangerous
finding — it means the test suite can stay green while production is broken.

### 3.1 Audit all test files for duplicated logic
Search every `*.test.ts` for local re-implementations of production helpers
(`function cleanHtml`, `function extractTag`, etc.). For each:
- If it's a copy, replace with an import from the production module
- If the production function isn't exported, export it (pure functions are safe to export)
- Add a comment: "imports production logic — do not duplicate"

### 3.2 Add a test-integrity gate
A CI check that fails if a test file contains a function whose name matches an
exported production function. This catches the anti-pattern automatically.

### 3.3 Envelope-contract tests
For every API route that returns `{data, error}`, add a test that asserts the
envelope shape. The fear-greed bug returned `{data:{}, error:null}` — a test that
asserts "data is either a complete object or null, never {}" would have caught it.

---

## 4. Deploy Safety (this month)

### 4.1 Build-before-restart enforcement
The deploy script should be:
```
npm run build && npm run test && pm2 restart
```
Never `pm2 restart` alone. Consider a `scripts/deploy.sh` that enforces this
ordering and verifies chunk parity before declaring success.

### 4.2 Canary verification
After deploy, hit a known endpoint and verify the response shape matches what
the new code produces. The audit's "served md5 == local md5" check is the
strongest signal — automate it.

---

## 5. Monitoring & Alerting (this month)

The audit found defects by manual probing. Automate that.

### 5.1 Synthetic page checks
Run `scripts/qa-browser-sweep.mjs` (or a subset) on a cron. Alert on:
- Any page with console errors
- Any page that drops below a text-length threshold
- Any API route that 5xx's

### 5.2 Feed-quality alert
When the news feed's item count drops >50% from its 7-day average, alert. The
markup-leak check (regex for `<[a-z/][^>]*>` in titles/summaries) should run on
every feed cycle and alert on any hit.

### 5.3 Upstream latency tracking
Log p50/p95 latency per external API call. The `/market` 500 was a cold-cache
miss — latency tracking would surface degradation before it becomes a 500.

---

## 6. Feature Gaps (next quarter)

What the audit surfaced as missing, not broken.

### 6.1 Anonymous UX for premium surfaces
Seven pages 401 for anonymous users and render an empty shell. This is correct
but poor UX. Add a consistent "Sign in to unlock" state for auth-gated panels
rather than showing empty data tables.

### 6.2 Indonesia macro route
`/api/v1/indonesia-macro` returns World Bank data; FRED data (BI Rate, CPI, GDP)
was empty because the live process wasn't loading `.env`. Confirmed fixed after
restart — BI Rate 6.00%, CPI 133.5 now live. Wire a panel into the dashboard
alongside the global-macro panel.


### 6.3 Dashboard personalization
The dashboard is a fixed grid. The next step: let users pin/reorder panels,
persist layout to localStorage or account settings. The data layer already
supports it (single `fetchAll` fan-out).

### 6.4 Missing audit surfaces
The audit covered pages and API routes. Not covered:
- WebSocket namespace behavior (verified manually, not automated)
- Cron job outputs (alpha-track, feed harvest, harvesters)
- Telegram bot command surface
- Email/payment flows

Add these to the audit harness.

---

## 7. The Meta-Rule

**Never trust a status code.** The app is a client-side shell that returns 200 +
empty HTML for every route. The audit's real signal was:
1. Console errors (browser)
2. Failed network requests (browser)
3. Rendered text length (browser)
4. API envelope shape (HTTP + JSON parse)
5. Served-vs-built chunk parity (deploy)

Any future QA that relies on `curl -o /dev/null -w '%{http_code}'` will produce
false negatives. Always verify in a browser with console capture.

---

*Generated 2026-09-13 from full live audit of tracker.aitradepulse.com*
