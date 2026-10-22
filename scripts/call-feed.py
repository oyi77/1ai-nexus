#!/usr/bin/env python3
"""Call-feed hunter: read operator call channels, score token confluence.

Reads recent messages from the operator's 12 call channels via the live
user session (read-only), extracts contract addresses, and emits candidate
rows ranked by how many INDEPENDENT channels called the same token.

A token called by N channels is N independent mentions — confluence, not
a single KOL's shill. Output is a JSON array consumed by the TS screening
pipeline (sniper-scan / sniper-source); this script scores attention only,
never safety. Every safety gate stays in the TS evaluator.

Usage: python3 scripts/call-feed.py [--limit 12] [--window-min 1440]
Env required: TELEGRAM_API_ID, TELEGRAM_API_HASH (same as leak finder).
Session: ~/.openclaw/workspace/vilona_session (read-only).

Weighted confluence scoring: raw `source_count` treats every channel as
equally credible, so a spam shill counts the same as a track-recorded
Alpha Caller. When `data/caller-scores.json` (produced by
scripts/fetch-caller-scores.py) is present, each mention contributes the
caller's measured weight (win rate x realized multiple, clamped 0.1-5.0)
to a per-token `weighted_score`, and every token carries the
`caller_weights` map of its contributing channels. Channels with no
matching caller name fall back to 1.0, so the artifact is strictly
additive: absent the scores file the script degrades to the old
unweighted ranking. Ordering stays source_count-first, then by
weighted_score instead of raw mention count.
"""
import argparse
import asyncio
import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone

from telethon import TelegramClient

from call_feed_contracts import (
    chain_of,
    extract_evm,
    extract_sol,
    is_plausible_sol,
    is_usable_contract,
    pick_repair,
)

CHANS = [
    ('SeekrTrending', 'trend'),
    ('solearlytrending', 'trend'),
    # Operator hunting channels (2026-10-12): csolbix verified live via
    # probe (last post 2026-10-11). PumpLivePool REMOVED — last post
    # 2025-08-13 (dead 2 months, zero candidates). trendingssol REMOVED —
    # resolvable but EMPTY (no readable posts). Dead channels cost a fetch
    # every 2 min for nothing; re-add only after a live probe proves posts.
    ('csolbix', 'trend'),
    ('AlphAI_signals_bsc_en', 'smart-money'),
    ('AlphAI_signals_sol_en', 'smart-money'),
    ('CallAnalyser2', 'score'),
    ('whaleBuyBotFree', 'whale'),
    ('gamblercallzone', 'shill'),
    ('ClubWhaleHunters', 'whale'),
    ('neeyo77xcalls', 'kol'),
    ('gem_tools_calls', 'tool'),
    ('CallAnalyser', 'score'),
    ('KingdomOfDegenCalls', 'shill'),
]


STATE_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'call-feed-state.sqlite')


def load_scores(path: str) -> dict[str, float]:
    """Load caller name/id -> weight from caller-scores.json. Empty dict if absent."""
    try:
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f'SCORES-MISSING {path}: all weights default to 1.0', file=sys.stderr)
        return {}
    except (json.JSONDecodeError, OSError) as e:
        print(f'SCORES-BAD {path}: {type(e).__name__}: all weights default to 1.0', file=sys.stderr)
        return {}
    scores: dict[str, float] = {}
    for name, rec in (data.get('callers') or {}).items():
        w = rec.get('weight')
        if isinstance(w, (int, float)) and name:
            scores[name.strip().lstrip('@').lower()] = float(w)
    for name, rec in (data.get('callers_by_id') or {}).items():
        w = rec.get('weight')
        if isinstance(w, (int, float)) and name:
            scores[name.strip().lstrip('@').lower()] = float(w)
    return scores


UNSCORED_WEIGHT = 0.25


def caller_weight(scores: dict[str, float], channel: str) -> float:
    """Measured weight for a channel, or UNSCORED_WEIGHT when unmeasured.

    A channel absent from the measurement has no evidence of originating
    calls: it may be a mirror that only re-broadcasts another group's
    post. Giving it a full 1.0 vote would let a pure reposter corroborate
    itself, so unscored channels keep a reduced vote and are reported in
    the artifact as `unscored_sources` for the operator to see.
    """
    return scores.get(channel.strip().lstrip('@').lower(), UNSCORED_WEIGHT)


def upsert_state(cur: "sqlite3.Cursor", contract: str, source: str, msg_id: int, ts: str) -> bool:
    if not is_usable_contract(contract):
        return False
    try:
        cur.execute(
            'INSERT INTO mentions(contract, source, msg_id, seen_at) VALUES(?,?,?,?)',
            (contract, source, msg_id, ts),
        )
        return True
    except sqlite3.IntegrityError:
        return False  # same (contract, source, msg_id) already seen


async def repair_state(db: "sqlite3.Connection", client, limit: int) -> dict[str, str]:
    """Re-derive poisoned contracts by re-reading their source messages.

    A stored value cannot prove whether a leading `3A` is part of the mint or
    the tail of an escaped ':' -- a genuine 45-character `3A` mint and a
    46-character corrupted row are both valid base58. The only honest
    recovery is the raw text, so every suspect is re-read once and accepted
    only when its message yields exactly one mint.
    """
    suspects = [contract for contract in _SUSPECTS(db)]
    if not suspects:
        return {}
    rows = db.execute(
        'SELECT contract, source, msg_id FROM mentions WHERE contract IN (%s)'
        % ','.join('?' * len(suspects)),
        suspects,
    ).fetchall()
    entities: dict[str, object] = {}
    repairs: dict[str, str] = {}
    unresolved = 0
    for contract, source, msg_id in rows[:limit]:
        if contract in repairs:
            continue
        if source not in entities:
            try:
                entities[source] = await client.get_entity(source)
            except Exception as exc:  # noqa: BLE001
                print(f'REPAIR-ENTITY-FAIL {source}: {type(exc).__name__}', file=sys.stderr)
                entities[source] = None
        if entities[source] is None:
            unresolved += 1
            continue
        try:
            message = await client.get_messages(entities[source], ids=msg_id)
        except Exception as exc:  # noqa: BLE001
            print(f'REPAIR-FETCH-FAIL {source}/{msg_id}: {type(exc).__name__}', file=sys.stderr)
            unresolved += 1
            continue
        fixed = pick_repair(contract, extract_sol((message.text if message else '') or ''))
        if fixed and fixed != contract:
            repairs[contract] = fixed
        else:
            unresolved += 1
    for bad, fixed in repairs.items():
        db.execute(
            'INSERT OR IGNORE INTO mentions(contract, source, msg_id, seen_at) '
            'SELECT ?, source, msg_id, seen_at FROM mentions WHERE contract = ?',
            (fixed, bad),
        )
        db.execute('DELETE FROM mentions WHERE contract = ?', (bad,))
    db.commit()
    print(f'REPAIRED {len(repairs)} contracts, unresolved {unresolved}', file=sys.stderr)
    return repairs


def load_window(db: "sqlite3.Connection", cutoff: str, scores: dict[str, float]) -> list[dict]:
    """Candidates from the STORE, not from this pass's fetch.

    Mentions are timestamped ISO-8601 UTC, so a lexical comparison is exact and
    keeps sqlite from parsing dates. Grouped in Python because the source list
    and weights need the same caller_weight() the live path uses.
    """
    rows: dict[str, dict] = {}
    for contract, source, ts in db.execute(
            'SELECT contract, source, seen_at FROM mentions WHERE seen_at >= ?', (cutoff,)):
        if not is_usable_contract(contract):
            continue
        rec = rows.setdefault(contract, {'contract': contract, 'chain': chain_of(contract),
                                         'mentions': 0, 'sources': [],
                                         'first_seen': ts, 'last_seen': ts,
                                         'kinds': set(), 'weighted_score': 0.0,
                                         'caller_weights': {}})
        rec['mentions'] += 1
        if source not in rec['sources']:
            rec['sources'].append(source)
        rec['caller_weights'][source] = caller_weight(scores, source)
        rec['first_seen'] = min(rec['first_seen'], ts)
        rec['last_seen'] = max(rec['last_seen'], ts)
    for rec in rows.values():
        rec['weighted_score'] = sum(rec['caller_weights'].values())
    return sorted(rows.values(), key=lambda r: (-len(r['sources']), -r['weighted_score']))


def _SUSPECTS(db: "sqlite3.Connection") -> list[str]:
    return [contract for (contract,) in db.execute('SELECT DISTINCT contract FROM mentions')
            if not is_plausible_sol(contract) and contract.endswith('pump')]


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=25)
    ap.add_argument('--window-min', type=int, default=1440)
    ap.add_argument('--scores-file', default='data/caller-scores.json')
    ap.add_argument('--repair-limit', type=int, default=400,
                    help='max poisoned rows re-read per pass (0 disables repair)')
    ap.add_argument('--emit', default='',
                    help='write the artifact here instead of stdout (atomic rename)')
    args = ap.parse_args()

    scores = load_scores(args.scores_file)

    api_id = int(os.environ.get('TELEGRAM_API_ID', '0') or 0)
    api_hash = os.environ.get('TELEGRAM_API_HASH', '')
    if not api_id or not api_hash:
        print('Set TELEGRAM_API_ID / TELEGRAM_API_HASH', file=sys.stderr)
        return 2

    os.makedirs(os.path.dirname(STATE_DB), exist_ok=True)
    db = sqlite3.connect(STATE_DB)
    cur = db.cursor()
    cur.execute('''CREATE TABLE IF NOT EXISTS mentions(
        contract TEXT, source TEXT, msg_id INTEGER, seen_at TEXT,
        PRIMARY KEY (contract, source, msg_id))''')

    c = TelegramClient(os.path.expanduser('~/.openclaw/workspace/vilona_session'), api_id, api_hash)
    await c.connect()
    if not await c.is_user_authorized():
        print('NOT_AUTHORIZED', file=sys.stderr)
        return 2

    if args.repair_limit > 0:
        await repair_state(db, c, args.repair_limit)

    # The window bounds the STORE and the OUTPUT, not just the fetch. Building
    # candidates only from messages read in this pass dropped any token whose
    # calls predate the per-channel limit: the Telegram fetch stops at
    # `limit` messages, so a busy channel pushes an older call off the end and
    # the token vanishes from the artifact while still sitting in the store.
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=args.window_min)).isoformat()
    mentions: dict[str, dict] = {}
    new_rows = 0
    for handle, kind in CHANS:
        try:
            async for m in c.iter_messages(handle, limit=args.limit):
                ts = m.date.replace(tzinfo=timezone.utc).isoformat()
                if ts < cutoff:
                    break
                text = m.text or ''
                for ca in set(extract_sol(text)) | set(extract_evm(text)):
                    if upsert_state(cur, ca, handle, m.id, ts):
                        new_rows += 1
                    rec = mentions.setdefault(ca, {'contract': ca, 'chain': chain_of(ca),
                                                  'mentions': 0, 'sources': [], 'first_seen': ts,
                                                  'last_seen': ts, 'kinds': set(),
                                                  'weighted_score': 0.0, 'caller_weights': {}})
                    rec['weighted_score'] += caller_weight(scores, handle)
                    rec['caller_weights'][handle] = caller_weight(scores, handle)
                    rec['mentions'] += 1
                    if handle not in rec['sources']:
                        rec['sources'].append(handle)
                    rec['first_seen'] = min(rec['first_seen'], ts)
                    rec['last_seen'] = max(rec['last_seen'], ts)
                    rec['kinds'].add(kind)
        except Exception as e:  # noqa: BLE001 — one dead channel must not kill the pass
            print(f'CHAN-FAIL {handle}: {type(e).__name__}', file=sys.stderr)

    db.commit()
    for contract in _SUSPECTS(db):
        mentions.pop(contract, None)
    rows = load_window(db, cutoff, scores)
    out = [{**r, 'kinds': sorted(r['kinds']),
            'source_count': len(r['sources']), 'weighted_score': round(r['weighted_score'], 4)}
           for r in rows]
    scored = set(scores)
    unscored = sorted({s for r in rows for s in r['sources']
                       if s.strip().lstrip('@').lower() not in scored})
    payload = {'generated_at': datetime.now(timezone.utc).isoformat(),
               'window_min': args.window_min, 'new_mentions': new_rows,
               'unscored_sources': unscored, 'candidates': out}
    if args.emit:
        # Write-then-rename: a reader (sync:call-feed, every 2 min, offset 45s)
        # must never see a half-written artifact, and a killed pass must never
        # leave the previous good one truncated.
        tmp = args.emit + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(payload, f, indent=1)
        os.replace(tmp, args.emit)
    else:
        print(json.dumps(payload, indent=1))
    await c.disconnect()
    db.close()
    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
