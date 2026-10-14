#!/usr/bin/env python3
"""Fetch Telegram Alpha Caller rankings from Solpump and write caller weights.

Calls the public keyless endpoint
    GET https://trade.solpump.io/api/v2/watchlist/ranking/all?timeframe=30d
paginating via `nextCursor` (max 5 pages by default), filters to
`source.type == "CALLER"` and drops noisy callers below --min-calls.

Each retained caller gets a confluence weight:
    weight = winRatePct/100.0 * (1 + min(averageMultiplier, 1000) / 1000.0)
clamped to [0.1, 5.0]. Output `data/caller-scores.json` maps caller name
(and caller id) to {id, name, winRatePct, totalCalls, averageMultiplier,
topBucket, weight}. The TS call-feed pipeline consumes it for weighted
confluence scoring; this script never touches candidate safety gates.

Usage: python3 scripts/fetch-caller-scores.py [--timeframe 30d] [--output ...]
Exit codes: 0 ok, 1 partial data (some pages failed), 2 no data at all.
Stdlib only — no external dependencies.
"""
import argparse
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone

API_URL = 'https://trade.solpump.io/api/v2/watchlist/ranking/all'
DEFAULT_TIMEOUT = 15
DEFAULT_RETRIES = 2
RETRY_BACKOFF_S = 2.0


def _request_json(url: str, timeout: int = DEFAULT_TIMEOUT, retries: int = DEFAULT_RETRIES) -> dict | None:
    """GET url and parse JSON, retrying on transport/parse errors. None if exhausted."""
    last_err: Exception | None = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode('utf-8'))
        except Exception as e:  # noqa: BLE001 — retry any transport/parse failure
            last_err = e
            if attempt < retries:
                time.sleep(RETRY_BACKOFF_S)
    print(f'FETCH-FAIL {url}: {type(last_err).__name__}: {last_err}', file=sys.stderr)
    return None


def top_bucket(buckets: list[dict]) -> str:
    """Tier with the highest count, excluding the <2x tier."""
    best_tier, best_count = '', -1
    for b in buckets:
        tier = b.get('tier', '')
        if tier == '<2x':
            continue
        count = b.get('count', 0)
        if count > best_count:
            best_tier, best_count = tier, count
    return best_tier if best_tier else '<2x'


def compute_weight(win_rate_pct: float, average_multiplier: float) -> float:
    w = (win_rate_pct / 100.0) * (1.0 + min(average_multiplier, 1000.0) / 1000.0)
    return max(0.1, min(5.0, w))


def fetch_callers(timeframe: str, min_calls: int, max_pages: int) -> tuple[list[dict], int]:
    """Paginate the ranking endpoint; return (filtered caller items, failed page count)."""
    items: list[dict] = []
    failed_pages = 0
    cursor = ''
    for _ in range(max_pages):
        url = f'{API_URL}?timeframe={timeframe}&rankBy=totalCalls&orderBy=desc'
        if cursor:
            url += f'&cursor={cursor}'
        payload = _request_json(url)
        if payload is None:
            failed_pages += 1
            if not items:
                break  # nothing at all yet — first-page failure is fatal
            continue
        for it in payload.get('items', []):
            src = it.get('source') or {}
            if src.get('type') != 'CALLER':
                continue
            if (it.get('totalCalls') or 0) < min_calls:
                continue
            items.append(it)
        cursor = payload.get('nextCursor') or ''
        if not cursor:
            break
    return items, failed_pages


def build_output(items: list[dict], timeframe: str) -> dict:
    callers: dict[str, dict] = {}
    by_id: dict[str, dict] = {}
    for it in items:
        src = it.get('source') or {}
        name = src.get('name') or ''
        cid = src.get('id') or ''
        rec = {
            'id': cid,
            'name': name,
            'winRatePct': it.get('winRatePct'),
            'totalCalls': it.get('totalCalls'),
            'averageMultiplier': it.get('averageMultiplier'),
            'topBucket': top_bucket(it.get('multiplierBuckets') or []),
            'weight': compute_weight(it.get('winRatePct') or 0.0, it.get('averageMultiplier') or 0.0),
        }
        if name:
            callers[name] = rec
        if cid:
            by_id[cid] = rec
    return {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'source': 'trade.solpump.io/api/v2/watchlist/ranking/all',
        'timeframe': timeframe,
        'caller_count': len(items),
        'callers': callers,
        'callers_by_id': by_id,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--timeframe', default='30d', choices=['1d', '7d', '30d', '90d'])
    ap.add_argument('--output', default='data/caller-scores.json')
    ap.add_argument('--min-calls', type=int, default=20)
    ap.add_argument('--max-pages', type=int, default=5)
    args = ap.parse_args()

    items, failed_pages = fetch_callers(args.timeframe, args.min_calls, args.max_pages)
    if not items:
        print('NO-DATA: no qualifying callers fetched', file=sys.stderr)
        return 2

    out = build_output(items, args.timeframe)
    out_dir = os.path.dirname(os.path.abspath(args.output))
    os.makedirs(out_dir, exist_ok=True)
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=1)
    print(f'wrote {args.output}: {out["caller_count"]} callers, failed_pages={failed_pages}')
    return 1 if failed_pages else 0


if __name__ == '__main__':
    sys.exit(main())
