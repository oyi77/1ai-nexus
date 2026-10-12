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
"""
import argparse
import asyncio
import json
import os
import re
import sqlite3
import sys
from datetime import datetime, timedelta, timezone

from telethon import TelegramClient

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

SOL = re.compile(r'[1-9A-HJ-NP-Za-km-z]{32,44}pump')
EVM = re.compile(r'0x[0-9a-fA-F]{40}')

STATE_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'call-feed-state.sqlite')


def chain_of(contract: str) -> str:
    if contract.startswith('0x'):
        return 'bsc'  # evm-family; chain resolved downstream by audit fan-out
    return 'solana'


def upsert_state(cur: "sqlite3.Cursor", contract: str, source: str, msg_id: int, ts: str) -> bool:
    try:
        cur.execute(
            'INSERT INTO mentions(contract, source, msg_id, seen_at) VALUES(?,?,?,?)',
            (contract, source, msg_id, ts),
        )
        return True
    except sqlite3.IntegrityError:
        return False  # same (contract, source, msg_id) already seen


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=25)
    ap.add_argument('--window-min', type=int, default=1440)
    args = ap.parse_args()

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

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=args.window_min)
    mentions: dict[str, dict] = {}
    new_rows = 0
    for handle, kind in CHANS:
        try:
            async for m in c.iter_messages(handle, limit=args.limit):
                if m.date.replace(tzinfo=timezone.utc) < cutoff:
                    break
                text = m.text or ''
                for ca in set(SOL.findall(text)) | set(EVM.findall(text)):
                    key = (ca, handle)
                    ts = m.date.isoformat()
                    if upsert_state(cur, ca, handle, m.id, ts):
                        new_rows += 1
                    rec = mentions.setdefault(ca, {'contract': ca, 'chain': chain_of(ca),
                                                  'mentions': 0, 'sources': [], 'first_seen': ts,
                                                  'last_seen': ts, 'kinds': set()})
                    rec['mentions'] += 1
                    if handle not in rec['sources']:
                        rec['sources'].append(handle)
                    rec['first_seen'] = min(rec['first_seen'], ts)
                    rec['last_seen'] = max(rec['last_seen'], ts)
                    rec['kinds'].add(kind)
        except Exception as e:  # noqa: BLE001 — one dead channel must not kill the pass
            print(f'CHAN-FAIL {handle}: {type(e).__name__}', file=sys.stderr)

    db.commit()
    rows = sorted(mentions.values(), key=lambda r: (-len(r['sources']), -r['mentions']))
    out = [{**r, 'sources': r['sources'], 'kinds': sorted(r['kinds']),
            'source_count': len(r['sources'])} for r in rows]
    print(json.dumps({'generated_at': datetime.now(timezone.utc).isoformat(),
                      'window_min': args.window_min, 'new_mentions': new_rows,
                      'candidates': out}, indent=1))
    await c.disconnect()
    db.close()
    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
