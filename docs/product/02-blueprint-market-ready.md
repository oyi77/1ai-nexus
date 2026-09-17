# Blueprint: NEXUS Market-Ready Increment
Date: 2026-09-17 | Decisions: D1=B, D2=full batch, D3=reframe | Status: APPROVED FOR BUILD

## Milestones (in order)
| # | Milestone | Owner files | Done when |
|---|---|---|---|
| M1 | `IntegrationSecret` table + migration | `prisma/schema.prisma`, `prisma/migrations/add_integration_secrets_*/` | migrate status clean, resolve-applied pattern |
| M2 | Crypto seam + resolver rewire | `src/lib/secrets.ts` (new), `idx-stockbit/session.ts` | DB-first, file-second, env-third; rotation persists to DB |
| M3 | Admin API `GET/POST /api/v1/admin/integrations` | `src/app/api/v1/admin/integrations/route.ts` (new) | requireAdmin, JWT-shape + live-200 validation before save, redacted logs |
| M4 | Admin UI section | `src/app/admin/page.tsx` | stage/rotate/revoke + health row, non-admin never sees section |
| M5 | G1 harvest full universe | `idx-stockbit-harvest.ts` (bandar full, analyst full-831) | cron runtime acceptable, DB counts verified |
| M6 | G2 ARA reframe | `SignalsView.tsx` ARA tab | caution footnote + verdict label, no buy language |
| M7 | G3 disk proposal | `docs/product/05-disk-audit.md` | deletion candidate list, NO deletes outside repo |
| M8 | G4 RSS re-probe | feed-health cron + `data/feeds.json` | dead replaced/dropped, baseline reset, monitor green |
| M9 | G5 US count comment | `universe.ts` header | discrepancy documented in code |
| M10 | G6 calendar/dual/indices UI | signals page and/or hub cards | all three reachable from UI, live-verified |
| M11 | QA battery (per QA doc) + full gates + ship | — | suite/build/monitor green, commits pushed, timeline |

## Sequencing constraints
- M1 → M2 → M3 → M4 (storage chain).
- M5–M10 parallelizable after M2 (independent files), single battery at end.
- Non-admin UX (U4): any 503 from missing token renders generic "temporarily unavailable" — the staging hint stays admin-only. Enforced in route catch branches.

## Out of scope (explicit)
- Carina trading chain (needs PIN — never).
- WS tape ticks (needs live session; client already shipped, documented blocked).
- Deleting anything outside 1ai-tracker (disk proposal only).
