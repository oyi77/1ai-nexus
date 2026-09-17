# G3 Disk Audit Proposal (NO deletes executed)
Date: 2026-09-17 | Host root /dev/sdc2 448G, 392G used, 37G avail (92%).

## Measured (2026-09-17)
| Path | Size | Notes |
|---|---|---|
| /tmp (total) | 3.2G | 379 *.log files, 92M in top logs alone; sweep/suite logs ~1.7M each |
| 1ai-tracker/node_modules | 1.4G | reinstallable via npm ci |
| 1ai-tracker/.next | 540M | build artifact, regenerates on next build |
| 1ai-tracker/data | 6.4M | snapshots; global 2.7M, historical 1.8M, idx 1.3M |
| sibling repos (each) | 2–7.7G | 1ai-hub 7.7G, OpenMedallion 7.0G, OmniRoute 6.9G, 1ai-content 6.2G — OUTSIDE this repo's authority |

## Candidates (proposal only — nothing deleted)
1. /tmp/*.log rotation (379 files, ~92M+): compress or delete logs older than 7 days. Biggest wins: sweep-suite*.log, suite*.log (1.7M each × dozens). Requires tmpwatch/logrotate or manual `find /tmp -name '*.log' -mtime +7 -delete` — needs operator confirm (outside repo).
2. 1ai-tracker/.next (540M): `npm run build` regenerates; safe to `rm -rf .next` before a fresh build. Inside repo authority — do at deploy time, not now (would force rebuild).
3. Sibling-repo node_modules/.next (multi-GB each): outside authority; per-repo owners must prune.
4. Docker overlay / journald: not measured (needs sudo docker system df / journalctl --disk-usage) — operator action.

## Decision
- This increment executes ZERO deletes (QA Q5-G3). Disk risk stays OPEN and escalated to operator.
- Recommended operator actions in order: (a) tmp log rotation, (b) docker system prune, (c) journal vacuum, (d) per-repo .next prune at deploy.
