# Brainstorm: NEXUS Market-Ready Increment
Date: 2026-09-17 | Status: DRAFT — awaiting decisions (§5)

## 0. Scope of this increment
Close the gap between "RE proven + providers live" and "siap dipasarkan":
(a) admin token management without SSH, (b) all no-token gaps resolved.

## 1. User types (grounded in repo: User.role, plan tiers, API keys)
| Type | Who | Auth | Needs |
|---|---|---|---|
| Admin | operator/owner (role=admin) | nexus-session + role check | stage/rotate/revoke integration tokens, see integration health, manage feeds/users/billing, read monitor |
| User | registered free account | nexus-session | view all pages/signals, watchlist, personal alerts; never touches tokens; sees graceful 503, never stack traces |
| Customer | paying (pro/enterprise) | API key + plan limits | everything User has + higher rate limits, premium lanes (signals/history today 401 for anonymous), API access with docs |

## 2. Use cases × types (token management)
| # | Who | Flow | Must hold |
|---|---|---|---|
| U1 | Admin | stage Stockbit refresh token (first time) | validates JWT shape + live 200 before saving; never logs token; success shows health OK |
| U2 | Admin | rotate/revoke token | old token invalidated (single-writer note), harvest picks up new within one cron cycle, no restart |
| U3 | Admin | see integration health | token valid? expiry? last harvest rows? last error? — one screen, no SSH |
| U4 | User/Customer | view calendar/tape/guru-full | works when token healthy; 503 + staging hint NEVER shown to non-admin (generic "temporarily unavailable") |
| U5 | Admin | token dies mid-cycle (401/rotated elsewhere) | harvest alerts, admin banner appears, re-stage path is one click from banner |
| U6 | Attacker | steals/leaks token, CSRF, privilege escalation | non-admin 403 on all mutation endpoints; tokens encrypted at rest; redacted in every log; rotation documented |

## 3. Options: token storage
### A. Env-only (status quo + docs)
- How: operator SSHs, edits `.env`, `pm2 restart`. Already documented in `.env.example`.
- Pros: zero code, zero new attack surface, works tonight.
- Cons: requires shell (cannot delegate, cannot sell SaaS that needs SSH to configure); restart blip; no health visibility; rotation is manual.
- Effort: 0 sessions.

### B. Admin UI + DB-backed encrypted store (RECOMMENDED for market-ready)
- How: new `IntegrationSecret` table (key, AES-GCM ciphertext, updatedAt; key from env `SECRETS_MASTER_KEY`), session resolver reads DB-first/file-second, `POST /api/v1/admin/integrations` (requireAdmin), section in `/admin`, health row per integration (valid/expiry/last-harvest/last-error).
- Pros: no SSH, no restart, visible health, per-integration status for future providers (Ajaib keyless = "healthy by design", Stockbit = token state), revocable from UI.
- Cons: new table + migration + crypto code + UI + tests (~1-2 sessions); new secret-bearing surface to audit (CSRF/CORS/admin-JWT already patterned by feeds CRUD — reuse, don't invent).
- Effort: 1-2 sessions + full gate battery.

### C. Admin UI writing session file (middle ground)
- How: admin form writes `data/stockbit-session.json` via API route; rotation stays file-based.
- Pros: no DB table, no crypto code, UI convenience.
- Cons: file-write-from-web needs same hardening as B but yields no history/visibility/rotation tracking; half-measure that will be replaced by B later.
- Effort: ~1 session, then thrown away. NOT recommended.

## 4. Remaining gaps (no-token batch — same increment)
| # | Gap | Fix | Needs token? |
|---|---|---|---|
| G1 | Bandar harvest 5 codes, analyst top-200 | raise harvest defaults to full universe (bandar) + full 831 (analyst); verify cron runtime | No |
| G2 | ARA backtest −1.82% (buy signal doesn't work) | disposition: reframe ARA tab as caution/mean-reversion context, document in UI footnote + decision doc | No |
| G3 | Disk root 92% | audit + propose deletion list (NO unilateral deletes outside repo) | No |
| G4 | 8 dead RSS | replace or drop after re-probe; feeds-health baseline reset | No |
| G5 | US count 1314 vs 887 payload | document as upstream discrepancy in provider header (done verbally, needs code comment) | No |
| G6 | Calendar/dual/indices have API but no UI | add tabs or cards (signals page tab? hub cards?) | No |
| G7 | WS tape ticks | needs staged session | YES — unlocks with token |
| G8 | 8-template guru harvest | needs staged session | YES — unlocks with token |

## 5. Decisions required (user picks → blueprint next)
- D1: storage approach — A (env-only, ship now) / B (DB+UI, 1-2 sessions) / C (rejected by author, listed for completeness)?
- D2: scope — admin panel only, or + G1–G6 no-token batch in same increment?
- D3: ARA disposition — reframe-as-caution (recommended) / hide tab / keep as-is?
