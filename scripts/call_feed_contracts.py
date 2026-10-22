"""Contract extraction for the call-feed harvester.

Pure functions only: no network, no DB, no Telegram. This module exists so
the extraction rule can be tested in isolation, because the rule is where
an entire class of bug lives.

THE URL-ENCODED 3A TRAP (measured live, 2026-10-22):

Call channels embed a Twitter search URL whose query is percent-encoded:

    https://x.com/search?f=live&q=(%24alibi%20OR%20CWHunz...5pump
        %20OR%20url%3A9tTGCx...P76m%20OR%20url%3ACWHunz...5pump)&src=...

The old rule was a left-anchored greedy regex:

    SOL = re.compile(r'[1-9A-HJ-NP-Za-km-z]{32,44}pump')

`3A` from the escape `%3A` is itself base58, so the regex swallowed the
escape tail and emitted `3ACWHunz...pump` -- a token that does not exist.
Measured damage: 312 distinct tokens, 1,030 mention rows, from
gamblercallzone and ClubWhaleHunters. Verified against DexScreener, which
resolves 273/312 of the PREFIX-STRIPPED forms (87.5%, versus a 65% base rate
for un-corrupted mints) and 0/312 of the prefixed forms. Re-reading the raw
messages with the fixed scanner confirmed the mechanism for every sampled
row: the true mint is the same string minus the two-character escape tail.

Two independent defences, because byte length alone cannot discriminate a
30-byte prefixed run from a 29-byte real mint:

1. Decode percent-escapes before scanning, so `%3A` becomes ':' (not
   base58) and the mint starts at a real text boundary.
2. Require the run to start at a non-base58 boundary AND decode to at most
   32 bytes.

Measured safety margin for rule 2: across 12,870 live matches in seven
channels, ZERO mints are preceded by a base58 character.

REPAIRING STORED ROWS IS A DIFFERENT PROBLEM, and guessing is forbidden.
A stored value has lost both its surrounding text and its source message, so
no pure function can reconstruct the true mint by inspection: a genuine
44-character `3A` mint and a 45-character corrupted `3A` row are both valid
base58 of neighbouring lengths. `canonical_contract` therefore validates
only, and repairs only on proof:

* a body over 31 bytes is never a Solana mint -- measured across 6,518
  stored contracts, real bodies decode to 29, 30 or 31 bytes, and the only
  rows at 31 are the two genuine mints 3AFVt63G... and 3AHLPuUk... alongside
  the welded shape, so length alone cannot settle that case. The write gate
  sits at 30 for exactly that reason: it refuses the ambiguous band;

* dropping one leading `3A` must land on 29 or 30 bytes.

That rule is necessary but not sufficient, which is why the real repair is
driven by re-reading each source message and passing the verified result to
`salvage_payload(..., repairs={...})`. A string alone is never trusted to
identify which side of the ambiguity it is on: `canonical_contract` refuses
every body over 30 bytes, ambiguous or not, and lets the caller supply
proof.
"""
import re
from urllib.parse import unquote

B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
B58_INDEX = {ch: i for i, ch in enumerate(B58_ALPHABET)}
B58_CHARS = frozenset(B58_ALPHABET)

SOL_SUFFIX = 'pump'
SOL_BODY_BYTES = 32
SOL_MINT_MIN_BYTES = 29
SUSPECT_BODY_BYTES = 31
SOL_STORED_MAX_BYTES = 30

EVM_CA = re.compile(r'0[xX][0-9a-fA-F]{40}')


def b58decode_len(text: str):
    """Decoded byte length of a base58 string, or None if it is not base58.

    Leading '1' characters are zero bytes in base58, so they are counted
    separately from the big-integer part.
    """
    if not text:
        return None
    body = text.lstrip('1')
    zeros = len(text) - len(body)
    if not body:
        return zeros
    num = 0
    for ch in body:
        val = B58_INDEX.get(ch)
        if val is None:
            return None
        num = num * 58 + val
    return zeros + (num.bit_length() + 7) // 8


def normalize_text(text: str) -> str:
    """Decode percent-escapes so an encoded mint starts at a real boundary.

    `%3A` -> ':' removes the `3A` the old regex ate, and `%20` -> ' ' supplies
    the separator the encoder had replaced.
    """
    if '%' not in text:
        return text
    return unquote(text)


def trim_to_mint(run: str, suffix: str = SOL_SUFFIX, want_bytes: int = SOL_BODY_BYTES):
    """Longest suffix of `run` that is a plausible mint body + `suffix`.

    Boundary-agnostic: given only a run of base58 characters it cannot know
    where the mint starts, so a caller that can still see the surrounding
    text must use `scan_sol` instead. Returns None when nothing decodes.
    """
    if not run.endswith(suffix):
        return None
    body = run[: -len(suffix)]
    for start in range(len(body)):
        candidate = body[start:]
        nbytes = b58decode_len(candidate)
        if nbytes is None:
            return None
        if nbytes <= want_bytes:
            return candidate + suffix
    return None


def scan_sol(text: str) -> list:
    """Canonical Solana pump.fun mints, reading order, boundary-anchored.

    Scans for the suffix and walks LEFT only over base58 characters, so every
    candidate run starts at a non-base58 character or the start of the text.
    That is what stops `%3A` -> `3A` from ever becoming part of a mint: after
    `normalize_text` the ':' is not base58, so the walk stops there.
    """
    text = normalize_text(text)
    out = []
    idx = text.find(SOL_SUFFIX)
    while idx != -1:
        start = idx
        while start > 0 and text[start - 1] in B58_CHARS:
            start -= 1
        if start < idx:
            nbytes = b58decode_len(text[start:idx])
            if nbytes is not None and nbytes <= SOL_BODY_BYTES:
                mint = text[start:idx] + SOL_SUFFIX
                if mint not in out:
                    out.append(mint)
        idx = text.find(SOL_SUFFIX, idx + len(SOL_SUFFIX))
    return out


def pick_repair(stored: str, found) -> str:
    """The mint a stored corrupted value must have come from, from its message.

    A single match is the answer. With several, the true mint is the one the
    trap produced: the stored value minus its escape tail. Both the byte
    signature (a corrupted body decodes to 31 bytes, a real mint never does)
    and the exact string relation are checked, so a channel that posts two
    mints cannot be repaired by coincidence.
    """
    if not stored.endswith(SOL_SUFFIX):
        return ''
    if len(found) == 1:
        return found[0]
    candidates = [f for f in found if stored == '3A' + f]
    if len(candidates) == 1:
        return candidates[0]
    return ''


def extract_sol(text: str) -> list:
    return scan_sol(text)


def extract_evm(text: str) -> list:
    """Unique EVM addresses in reading order, lowercased for stable keys."""
    out = []
    for match in EVM_CA.finditer(normalize_text(text)):
        addr = match.group(0).lower()
        if addr not in out:
            out.append(addr)
    return out


def extract_contracts(text: str) -> list:
    """All contracts in a message: Solana mints canonicalised, then EVM."""
    return extract_sol(text) + extract_evm(text)


def chain_of(contract: str) -> str:
    return 'bsc' if contract.startswith('0x') else 'solana'


def is_plausible_sol(contract: str) -> bool:
    """True when a stored Solana value could be a real mint on its own.

    Measured 2026-10-22 over 6,518 stored pump contracts: bodies decode to 29,
    30 or 31 bytes. The two 31-byte rows are genuine mints (3AFVt63G...,
    3AHLPuUk...), so the ceiling sits at 31 rather than at the largest body
    minus nothing. The floor of 29 refuses word-shaped rows that merely end in
    `pump` (observed: `jonathanpump`, 7 bytes, no trading pair).
    """
    if not isinstance(contract, str) or not contract.endswith(SOL_SUFFIX):
        return False
    nbytes = b58decode_len(contract[: -len(SOL_SUFFIX)])
    if nbytes is None:
        return False
    return SOL_MINT_MIN_BYTES <= nbytes <= SUSPECT_BODY_BYTES


def canonical_contract(raw) -> str:
    """Canonical or provably-corrected form of a stored contract value.

    Returns '' when the value is not a usable contract, which callers treat
    as "drop this row". Corrections are limited to what byte structure can
    prove; see the module docstring for why a bare `3A` prefix on a
    plausible-length body is left untouched rather than guessed at.
    """
    if not isinstance(raw, str) or not raw:
        return ''
    if EVM_CA.fullmatch(raw):
        return raw.lower()
    if raw.lower().startswith('0x'):
        return ''
    if not raw.endswith(SOL_SUFFIX):
        return raw if is_plausible_sol(raw) else ''
    body = raw[: -len(SOL_SUFFIX)]
    nbytes = b58decode_len(body)
    if nbytes is None or not is_plausible_sol(raw):
        return ''
    if nbytes <= SOL_STORED_MAX_BYTES:
        return raw
    return ''


def is_usable_contract(contract) -> bool:
    """True when a stored value is a contract on whichever chain it belongs to.

    The Solana byte floor must never be applied to an EVM address: a
    42-character `0x…` value decodes to nothing under base58, so a chain-blind
    guard silently deletes every BSC call in the window (measured: 13 of 61
    contracts in one 60-minute window).
    """
    if not isinstance(contract, str) or not contract:
        return False
    if chain_of(contract) == 'bsc':
        return bool(EVM_CA.fullmatch(contract))
    return is_plausible_sol(contract)


def salvage_payload(payload: dict, repairs=None) -> dict:
    """Canonicalise a feed artifact and re-merge rows the trap split apart.

    `repairs` maps a stored contract to its verified true mint. Use it when
    the source messages are available; without it, only provable corrections
    are applied. Rows that collapse onto the same canonical contract are
    merged (sources unioned, mentions summed, time range widened, caller
    weights and weighted score combined) so a corrupted row folds into its
    twin instead of competing with it. Running twice is a no-op.
    """
    repairs = repairs or {}
    changed = []
    merged = {}
    order = []
    dropped = 0
    for row in payload.get('candidates') or []:
        if not isinstance(row, dict):
            dropped += 1
            changed.append(f'dropped {type(row).__name__} row')
            continue
        raw = row.get('contract')
        canonical = repairs.get(raw) or canonical_contract(raw)
        if canonical and not canonical_contract(canonical):
            changed.append(f'discarded unsafe repair {canonical!r} for {raw!r}')
            canonical = ''
        if not canonical:
            dropped += 1
            changed.append(f'dropped unparseable contract {raw!r}')
            continue
        rec = dict(row)
        rec['contract'] = canonical
        rec['chain'] = chain_of(canonical)
        rec['sources'] = list(dict.fromkeys(
            s for s in (rec.get('sources') or []) if isinstance(s, str) and s
        ))
        rec['kinds'] = list(dict.fromkeys(
            k for k in (rec.get('kinds') or []) if isinstance(k, str) and k
        ))
        if canonical not in merged:
            merged[canonical] = rec
            order.append(canonical)
            continue
        base = merged[canonical]
        base['sources'] = list(dict.fromkeys(list(base.get('sources') or []) + rec['sources']))
        base['mentions'] = (base.get('mentions') or 0) + (rec.get('mentions') or 0)
        base['kinds'] = list(dict.fromkeys(list(base.get('kinds') or []) + rec['kinds']))
        for key, pick in (('first_seen', min), ('last_seen', max)):
            vals = [v for v in (base.get(key), rec.get(key)) if isinstance(v, str)]
            if vals:
                base[key] = pick(vals)
        weights = dict(base.get('caller_weights') or {})
        weights.update(rec.get('caller_weights') or {})
        if weights:
            base['caller_weights'] = weights
        base['weighted_score'] = round(
            (base.get('weighted_score') or 0) + (rec.get('weighted_score') or 0), 4
        )
        changed.append(f'merged {canonical} with a split row')

    candidates = []
    for key in order:
        rec = merged[key]
        rec['source_count'] = len(rec.get('sources') or [])
        candidates.append(rec)
    candidates.sort(key=lambda r: (-(r.get('source_count') or 0), -(r.get('weighted_score') or 0)))

    out = dict(payload)
    out['candidates'] = candidates
    out['salvage'] = {
        'dropped': dropped,
        'merged': sum(1 for c in changed if c.startswith('merged')),
        'changed': changed,
    }
    return out
