# Decision Doc: Market-Ready Increment
Date: 2026-09-17 | Deciders: user (D1–D3 answers)

## D1 — Token storage: B (DB + UI). A rejected, C rejected.
- A (env-only) rejected as SOLE path: requires SSH per rotation, restart blip, zero health visibility, undelegatable — incompatible with "siap dipasarkan".
- C (UI writes session file) rejected: same hardening cost as B, none of the benefits (no history, no health, no rotation tracking); throwaway work.
- B chosen: standard secrets pattern, reuses existing `requireAdmin` + feeds-CRUD auth shape, single new table.

## D2 — Scope: full batch (admin + G1–G6).
- Rationale: each G-item is independently shippable; batching avoids six separate gate batteries. G7/G8 stay session-gated (honest blockers, documented).

## D3 — ARA tab: reframe as caution.
- Evidence: backtest ARA lane 32.9% win / −1.82% avg (70 signals, 5-session horizon). Chasing near-limit-up is a documented loser.
- Action: tab keeps data, header gains caution copy, no buy language. verdict field untouched (API contract frozen).

## Rejected alternatives log (anti-revisit)
| Proposal | Verdict | Reason |
|---|---|---|
| Validate RT without spending rotation | impossible | upstream rotates on every /login/refresh; validation ≡ staging (atomic) |
| Store plaintext token in DB | rejected | secrets at rest must be encrypted; SECRETS_MASTER_KEY from env |
| Merge calendar/dual/indices into one mega-route | rejected | existing per-route files + middleware entries; hub cards link out, no merge needed |
| Delete 8 dead RSS now | deferred to G4 | re-probe first; some may have recovered (transient timeouts observed) |
| Unilateral /tmp + root cleanup for disk 92% | rejected | outside repo authority; proposal doc only (G3) |
