#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# NEXUS autoresearch harness — "surpass hyperdash"
#
# Deterministic offline benchmark over committed snapshots:
#   METRIC bench_ops_per_sec  (higher = better, PRIMARY)
#   METRIC cold_start_ms      (lower = better)
#   METRIC instruments        (coverage breadth)
#
# No network. Fixed seed (mulberry32/1337). Same workload every run.
# ─────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"

exec npx tsx scripts/autoresearch-bench.ts
