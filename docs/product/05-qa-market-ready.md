# QA Doc: Market-Ready Increment
Date: 2026-09-17 | Blueprint: 02 | Execute only after ALL rows pass.

## Q1 — Secrets crypto (no network)
| Case | Action | Expect |
|---|---|---|
| roundtrip | encrypt→decrypt random 3× | identical plaintext |
| wrong key | decrypt with other master | throws (auth tag) |
| malformed blob | decrypt garbage/old version | throws, no crash |
| missing env | unset SECRETS_MASTER_KEY | actionable error naming the var |

## Q2 — Admin API (as admin AND non-admin AND anonymous)
| Case | Action | Expect |
|---|---|---|
| anonymous POST | no auth header | 403, identical body to wrong-role |
| user-role POST | valid non-admin JWT | 403 |
| admin POST bad shape | `{key:'x'}` / non-JWT value | 400, nothing written |
| admin POST dead token | random JWT | 400/502, nothing written, no rotation spent on OUR side |
| admin POST live-shape, dead value | JWT-shaped invalid | 400/502 after upstream 401, nothing written |
| admin GET list | valid admin | rows WITHOUT values; health fields present |
| STATE RULE | — | no test uses a real Stockbit token; live staging is a manual admin act, verified by health row only |

## Q3 — Resolver rewire
| Case | Action | Expect |
|---|---|---|
| DB row present | resolve with DB+file+env all set | DB value used |
| DB absent, file present | resolve | file value (old behavior preserved) |
| all absent | resolve/hasCredentials | actionable error / false |
| rotation | rotate with DB row existing | new pair persisted to DB (row updated, file untouched) |

## Q4 — Non-admin UX (U4)
| Case | Action | Expect |
|---|---|---|
| calendar, no token | GET as anonymous | 503 generic "temporarily unavailable", NO staging hint |
| calendar, no token | GET as admin | 503 WITH staging hint (existing behavior kept) |
| tape/guru-full, no token | same | same split |

## Q5 — G-batch
| G1 | harvest defaults raised | dry-run flags parse; full run count matches universe (no full 882 re-run in QA — accept prior 831 receipt + code review of limit change) |
| G2 | ARA tab | header shows caution copy; no "buy"/"strong-buy" language in tab; API untouched |
| G3 | disk proposal | doc lists candidates + sizes; ZERO deletes executed |
| G4 | RSS | re-probe 8 dead; replace/drop; feed-health green or documented-accepted |
| G5 | US count comment | `// 1314-vs-887` note present at universe fetch site |
| G6 | calendar/dual/indices UI | reachable from hub or signals page; live-verify each renders data (calendar 503-shape acceptable without token) |

## Q6 — Regression gates (repo standard)
tsc 0 · eslint 0 warnings on changed files · vitest green · build clean · push parity 2 · prod probes 200 · monitor green · secrets residue scan NONE · tree clean.
