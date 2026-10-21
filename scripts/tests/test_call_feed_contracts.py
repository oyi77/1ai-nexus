"""Tests for contract extraction - the URL-encoded 3A trap.

Every value here is measured, not invented. REAL/NATIVE_3A come from
data/call-feed-state.sqlite (2026-10-22), and the surrounding text is the
verbatim shape the channels publish, captured live from ClubWhaleHunters and
gamblercallzone.

The trap: channels embed a percent-encoded Twitter search URL, and the
trailing '3A' of '%3A' is base58. A left-anchored greedy regex eats it,
producing a mint that does not exist. Chain-verified: DexScreener resolves
273/312 of the stripped forms (87.5% vs a 65% base rate) and 0/312 of the
prefixed ones.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from call_feed_contracts import (
    SOL_SUFFIX,
    b58decode_len,
    canonical_contract,
    extract_contracts,
    extract_evm,
    extract_sol,
    is_plausible_sol,
    normalize_text,
    pick_repair,
    salvage_payload,
    trim_to_mint,
)

REAL = 'CWHunzmc7p7HYpbRvauduXZ66mfBFwEybkQHwNZ5pump'
TRAPPED = '3A' + REAL
# Measured live: a genuine mint whose body starts with '3A'. 45 chars / 30
# bytes, inside the legal mint size band, so the repair must not touch it.
NATIVE_3A = '3A1bZV8tb27yPsCsgbn2SVxpJRSkptTbNg5xAKXVBpump'
# The corrupted shape: 46 chars / 31 bytes, the signature of every one of
# the 279 poisoned rows. STRKT on-chain, and its twin 2Fad8... resolves.
ORPHAN_3A = '3A2Fad8taWxbaso6u1Cb91oV14p6m4PR52Gwc7TJRPpump'
ORPHAN_REAL = '2Fad8taWxbaso6u1Cb91oV14p6m4PR52Gwc7TJRPpump'
CLEAN_43 = '1RjmyJbkSeQFd2fmc2LBhnPF45dSGGBzNGo6bw9pump'
EVM = '0xabc0000000000000000000000000000000000001'

LIVE_MESSAGE = (
    'https://x.com/search?f=live&q=(%24alibi%20OR%20'
    + REAL[:-4]
    + '%20OR%20url%3A9tTGCxCsDqGZKFWo1gwPi2a4A3BTdkJSznjUvmeJP76m'
    + '%20OR%20url%3A'
    + REAL
    + ')&src=typed_query'
)


def test_the_trapped_run_is_exactly_two_characters_longer_than_the_mint():
    assert len(TRAPPED) == len(REAL) + 2


def test_byte_length_cannot_discriminate_the_trap():
    """Both fit in 32 bytes, so no length-only rule can separate them.

    This is why the fix is boundary-based: the guard must know where the run
    starts in the text, not merely how many characters it has.
    """
    assert b58decode_len(REAL[:-4]) == 29
    assert b58decode_len(TRAPPED[:-4]) <= 32


def test_normalizing_turns_the_escape_into_a_boundary():
    assert '%3A' not in normalize_text(LIVE_MESSAGE)
    assert 'url:' + REAL in normalize_text(LIVE_MESSAGE)


def test_live_message_resolves_to_exactly_one_mint():
    assert extract_sol(LIVE_MESSAGE) == [REAL]


def test_the_trap_shape_never_appears_in_output():
    found = extract_sol(LIVE_MESSAGE)
    assert TRAPPED not in found
    assert all(not m.startswith('3A') for m in found)


def test_a_mint_glued_to_letters_is_not_extracted():
    """Measured invariant: this never happens (0 of 12,870 live matches).

    When it DOES happen the text is ambiguous -- 'sent'+mint and a 43-char
    mint are indistinguishable -- so refusing is the honest answer. Emitting
    a wrong mint is the exact failure this module exists to prevent.
    """
    assert extract_sol(f'sent{REAL}') == []
    assert extract_sol(f'ca:{REAL}\nnext') == [REAL]
    assert extract_sol(f'({REAL})') == [REAL]


def test_a_native_3a_mint_survives_intact():
    assert len(NATIVE_3A) == 45
    assert b58decode_len(NATIVE_3A[:-4]) == 30
    assert extract_sol(f'new gem {NATIVE_3A}') == [NATIVE_3A]
    assert extract_sol(f'(%24x%20OR%20{NATIVE_3A})') == [NATIVE_3A]
    assert canonical_contract(NATIVE_3A) == NATIVE_3A


def test_pick_repair_takes_the_single_mint():
    assert pick_repair(TRAPPED, [REAL]) == REAL


def test_pick_repair_uses_the_escape_signature_when_two_mints_are_posted():
    """Measured live: ClubWhaleHunters posts the call mint plus the post's own.

    `gptpump` is a real false positive the boundary rule admits (a 3-character
    body is valid base58), so the choice must come from the string relation
    `stored == '3A' + mint` instead of from which mint is listed first.
    """
    stored = '3A5Vkxe8BNqGW4Sm5gf1khhe5J8PoifwVdEBQeLMZppump'
    real = '5Vkxe8BNqGW4Sm5gf1khhe5J8PoifwVdEBQeLMZppump'
    assert pick_repair(stored, [real, 'gptpump']) == real
    assert pick_repair(stored, ['gptpump', real]) == real


def test_pick_repair_refuses_without_a_proof():
    assert pick_repair(TRAPPED, ['gptpump', 'othermint']) == ''
    assert pick_repair(TRAPPED, []) == ''


def test_a_body_that_cannot_decode_is_rejected():
    assert trim_to_mint('pump') is None
    assert trim_to_mint('abc') is None
    assert extract_sol('0OIl' + REAL) == [REAL]


def test_evm_and_sol_are_extracted_together():
    text = f'{REAL} and 0xABC0000000000000000000000000000000000001'
    assert extract_contracts(text) == [REAL, EVM]


def test_evm_inside_an_encoded_query_is_found():
    text = f'q=(%24t%20OR%20url%3A{EVM.upper()})'
    assert extract_evm(text) == [EVM]


def test_zero_byte_leading_mints_are_not_over_stripped():
    assert b58decode_len('1') == 1
    assert b58decode_len('11') == 2
    assert trim_to_mint('1' + REAL[1:]) == '1' + REAL[1:]


def test_short_word_shaped_values_are_not_contracts():
    """Measured 2026-10-22: the extractor admitted `jonathanpump`.

    A 7-byte body is valid base58, so a suffix check alone let a word through
    into the feed, where it sat as a candidate with no trading pair. Real pump
    mints measure 29 to 31 bytes, so the floor is what refuses it.
    """
    assert b58decode_len('jonathan') == 6
    assert is_plausible_sol('jonathanpump') is False
    assert canonical_contract('jonathanpump') == ''
    assert is_plausible_sol('gptpump') is False
    assert is_plausible_sol(REAL) is True


def test_canonical_contract_refuses_what_bytes_cannot_prove():
    """Byte structure alone cannot pick a side, so the string layer refuses.

    TRAPPED has a legitimate twin shape, so repair comes from the source
    message via `repairs`, never from inspection.
    """
    assert canonical_contract(TRAPPED) == ''
    assert canonical_contract(ORPHAN_3A) == ''
    assert canonical_contract(REAL) == REAL
    assert canonical_contract(CLEAN_43) == CLEAN_43
    assert canonical_contract('garbage') == ''
    assert canonical_contract(None) == ''
    assert canonical_contract(0x9) == ''


def test_canonical_contract_is_idempotent():
    once = canonical_contract(REAL)
    assert canonical_contract(once) == once
    assert canonical_contract(canonical_contract(ORPHAN_3A)) == ''


def test_canonical_contract_refuses_the_ambiguous_33_byte_shape():
    """'3A' + 31-byte mint would need a 33-byte body to be real. Refuse it."""
    long_body = 'A' * 45
    assert canonical_contract(long_body + SOL_SUFFIX) == ''


def test_salvage_drops_a_poisoned_row_it_cannot_prove():
    assertion = {'candidates': [{'contract': ORPHAN_3A, 'sources': ['ClubWhaleHunters']}]}
    out = salvage_payload(assertion)
    assert out['candidates'] == []
    assert out['salvage']['dropped'] == 1


def test_salvage_folds_a_split_row_into_its_twin_and_drops_garbage():
    payload = {
        'generated_at': '2026-10-22T00:00:00+00:00',
        'candidates': [
            {
                'contract': REAL,
                'chain': 'solana',
                'sources': ['solearlytrending', 'CallAnalyser2'],
                'mentions': 3,
                'kinds': ['trend'],
                'first_seen': '2026-10-22T00:00:00+00:00',
                'last_seen': '2026-10-22T00:05:00+00:00',
                'weighted_score': 2.0,
                'caller_weights': {'solearlytrending': 1.0},
            },
            {
                'contract': TRAPPED,
                'chain': 'solana',
                'sources': ['ClubWhaleHunters'],
                'mentions': 1,
                'kinds': ['whale'],
                'first_seen': '2026-10-22T00:07:00+00:00',
                'last_seen': '2026-10-22T00:07:00+00:00',
                'weighted_score': 1.0,
                'caller_weights': {'ClubWhaleHunters': 1.0},
            },
            {'contract': 'garbage', 'sources': ['x'], 'mentions': 1},
            'not-a-row',
        ],
    }
    out = salvage_payload(payload, repairs={TRAPPED: REAL})
    rows = out['candidates']
    assert len(rows) == 1
    row = rows[0]
    assert row['contract'] == REAL
    assert row['source_count'] == 3
    assert row['mentions'] == 4
    assert row['kinds'] == ['trend', 'whale']
    assert row['first_seen'] == '2026-10-22T00:00:00+00:00'
    assert row['last_seen'] == '2026-10-22T00:07:00+00:00'
    assert row['weighted_score'] == 3.0
    assert out['salvage']['merged'] == 1
    assert out['salvage']['dropped'] == 2


def test_salvage_is_idempotent():
    payload = {'candidates': [{'contract': TRAPPED, 'sources': ['a'], 'mentions': 2}]}
    once = salvage_payload(payload, repairs={TRAPPED: REAL})
    twice = salvage_payload(once, repairs={TRAPPED: REAL})
    assert once['candidates'][0]['contract'] == REAL
    assert twice['candidates'] == once['candidates']
    assert twice['salvage']['dropped'] == 0
    assert twice['salvage']['merged'] == 0


def test_salvage_ranks_by_confluence_not_by_raw_mentions():
    payload = {
        'candidates': [
            {'contract': TRAPPED, 'sources': ['one'], 'mentions': 40},
            {'contract': CLEAN_43, 'sources': ['one', 'two', 'three'], 'mentions': 3},
        ]
    }
    rows = salvage_payload(payload, repairs={TRAPPED: REAL})['candidates']
    assert [r['source_count'] for r in rows] == [3, 1]
    assert rows[0]['contract'] == CLEAN_43
