#!/usr/bin/env python3
"""Measure each call group's ORIGIN RATE and rewrite caller weights.

Why: `source_count` counts groups flat, so a group that only re-broadcasts
another group's post counts as an independent confirmation. Measured
2026-10-22 over a 7-day window: `whaleBuyBotFree` originated 0 of its 263
contracts while it was credited with 263 confirmations, and
`CallAnalyser2` originated 93.1% of 5,341. Counting those two as "2
groups" is a fabricated confluence.

Origin rate is the only weight this script can measure honestly without
a price-history backtest:
    originRate = contracts this group saw FIRST / distinct contracts it saw
    weight     = 0.15 + 1.45 * originRate          clamped to [0.15, 1.6]
A pure mirror floors at 0.15 (it still saw the token, so it is not
evidence of nothing); a pure origin hub reaches 1.6. The TS side clamps
any weight to 1 when summing (`effectiveGroupCount`), so a prolific
caller can never clear a multi-group bar alone.

Writes `data/caller-scores.json` in place, PRESERVING records whose
`source` is not `telegram-origin` (e.g. a Solpump win-rate set written by
scripts/fetch-caller-scores.py), so the two producers cannot clobber each
other.

Usage: python3 scripts/refetch-call-group-weights.py [--days 7] [--dry]
Exit codes: 0 ok, 2 the state store is missing or unreadable.
Stdlib only — no external dependencies.
"""
import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE = os.path.join(ROOT, 'data', 'call-feed-state.sqlite')
OUT = os.path.join(ROOT, 'data', 'caller-scores.json')
FLOOR, SPAN = 0.15, 1.45


def measure(days: int) -> dict:
    """originRate per group over the last `days`, from the mention store."""
    if not os.path.exists(STATE):
        raise FileNotFoundError(STATE)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    con = sqlite3.connect(STATE)
    try:
        rows = con.execute(
            'select source, contract, seen_at from mentions where seen_at >= ?', (cutoff,)
        ).fetchall()
    finally:
        con.close()
    first: dict = {}
    groups: dict = {}
    for source, contract, seen_at in rows:
        groups.setdefault(source, set()).add(contract)
        if contract not in first or seen_at < first[contract]:
            first[contract] = seen_at
    originated: dict = {}
    for source, contract, seen_at in rows:
        if first[contract] == seen_at:
            originated[source] = originated.get(source, 0) + 1
    out = {}
    for source, contracts in groups.items():
        total = len(contracts)
        own = originated.get(source, 0)
        rate = own / total if total else 0.0
        out[source] = {
            'winRatePct': None,
            'totalCalls': total,
            'originatedCalls': own,
            'originRate': round(rate, 4),
            'weight': round(max(FLOOR, min(1.6, FLOOR + SPAN * rate)), 4),
            'source': 'telegram-origin',
        }
    return out


def merge(existing: dict, measured: dict) -> dict:
    """Keep foreign producers' records; replace telegram-origin ones."""
    kept = {
        name: rec for name, rec in existing.items()
        if isinstance(rec, dict) and rec.get('source') != 'telegram-origin'
    }
    kept.update(measured)
    return kept


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--days', type=int, default=7)
    ap.add_argument('--dry', action='store_true')
    args = ap.parse_args()

    try:
        measured = measure(args.days)
    except (FileNotFoundError, sqlite3.DatabaseError) as e:
        print(f'NO-STATE {e}: run scripts/call-feed.py first', file=sys.stderr)
        return 2
    if not measured:
        print('NO-DATA: the state store has no mentions in the window', file=sys.stderr)
        return 2

    try:
        with open(OUT, encoding='utf-8') as f:
            prior = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        prior = {}
    callers = merge(prior.get('callers') or {}, measured)
    doc = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'source': 'telegram-origin-measurement',
        'window_days': args.days,
        'method': f'originRate = contracts first seen here / distinct contracts; '
                  f'weight = {FLOOR} + {SPAN}*originRate clamped [0.15, 1.6]',
        'callers': callers,
    }
    if not args.dry:
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        with open(OUT, 'w', encoding='utf-8') as f:
            json.dump(doc, f, indent=2)
            f.write('\n')
    for name in sorted(measured):
        rec = measured[name]
        print(f"{name:22s} calls={rec['totalCalls']:5d} "
              f"origin={100 * rec['originRate']:5.1f}% weight={rec['weight']:.3f}")
    print(f"{'DRY-RUN' if args.dry else 'wrote'} {OUT}: "
          f"{len(measured)} measured, {len(callers)} total")
    return 0


if __name__ == '__main__':
    sys.exit(main())
