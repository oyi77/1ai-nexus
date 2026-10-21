// Tests for call-group confluence.
//
// The feed loader is injected through `opts.loadFeed` (the module's own seam),
// so the rejection path runs through the same try/catch production uses —
// no module-internals mocking.
import { afterEach, describe, expect, it } from 'vitest'
import {
  loadCallConfluence,
  clearsConfluence,
  describeConfluence,
  EMPTY_CONFLUENCE,
  type CallConfluence,
  type CallFeedRow,
} from '../call-confluence'
import { applyConfluenceBar } from '../strategy-intake'
import type { StrategyVerdict } from '../strategy-evaluator'

let feedRows: CallFeedRow[] = []
let feedBehavior: ((now: number, maxAge?: number) => Promise<CallFeedRow[]>) | null = null
let feedCalls = 0

const verdict = (over: Partial<StrategyVerdict> = {}): StrategyVerdict => ({
  strategy: 'second_wave',
  fired: true,
  confidence: 80,
  refs: [],
  entryUsd: 4_600_000,
  stopUsd: 3_600_000,
  targetUsd: 9_000_000,
  rr: 2.3,
  ...over,
})

const feedLoader = (now: number, maxAge?: number): Promise<CallFeedRow[]> => {
  feedCalls++
  return feedBehavior ? feedBehavior(now, maxAge) : Promise.resolve(feedRows)
}

afterEach(() => {
  feedRows = []
  feedBehavior = null
  feedCalls = 0
})

function feedRow(contract: string, extra: Partial<CallFeedRow> = {}): CallFeedRow {
  return {
    contract,
    chain: 'solana',
    sources: ['KingdomOfDegenCalls', 'ClubWhaleHunters'],
    sourceCount: 2,
    mentions: 5,
    kinds: ['score', 'whale'],
    firstSeen: '2026-10-20T11:00:00Z',
    lastSeen: '2026-10-20T11:59:00Z',
    weightedScore: 8,
    ...extra,
  }
}

describe('loadCallConfluence', () => {
  it('marks entries unavailable when the feed has no rows', async () => {
    feedRows = []
    const m = await loadCallConfluence(['abc'], { loadFeed: feedLoader })
    expect(m.get('abc')?.available).toBe(false)
    expect(m.get('abc')?.groupCount).toBe(0)
  })

  it('marks entries unavailable when the feed read throws', async () => {
    feedBehavior = async () => {
      throw new Error('db down')
    }
    const m = await loadCallConfluence(['abc'], { loadFeed: feedLoader })
    expect(m.get('abc')?.available).toBe(false)
    expect(m.get('abc')?.groups).toEqual([])
  })

  it('counts GROUPS (deduped), not messages, and keeps kinds + score', async () => {
    feedRows = [feedRow('abc', { mentions: 40, sources: ['A', 'A', 'B'] })]
    const c = (await loadCallConfluence(['abc'], { loadFeed: feedLoader })).get('abc')
    expect(c?.available).toBe(true)
    expect(c?.groups).toEqual(['A', 'B'])
    expect(c?.groupCount).toBe(2) // 40 messages in 2 groups is not 40 groups
    expect(c?.mentions).toBe(40)
    expect(c?.weightedScore).toBe(8)
    expect(c?.kinds).toEqual(['score', 'whale'])
  })

  it('reports trusted groups separately from all groups', async () => {
    feedRows = [feedRow('abc')]
    const c = (
      await loadCallConfluence(['abc'], {
        trustedGroups: ['ClubWhaleHunters'],
        loadFeed: feedLoader,
      })
    ).get('abc')
    expect(c?.trustedGroups).toEqual(['ClubWhaleHunters'])
    expect(c?.groups).toContain('KingdomOfDegenCalls')
  })

  it('leaves contracts absent from the feed untouched', async () => {
    feedRows = [feedRow('known')]
    const m = await loadCallConfluence(['known', 'unknown'], { loadFeed: feedLoader })
    expect(m.get('known')?.available).toBe(true)
    expect(m.get('unknown')?.available).toBe(false)
  })

  it('reads the feed once for the whole batch', async () => {
    await loadCallConfluence(['a', 'b', 'c'], { loadFeed: feedLoader })
    expect(feedCalls).toBe(1)
  })

  it('skips the feed entirely for an empty contract list', async () => {
    await loadCallConfluence([], { loadFeed: feedLoader })
    expect(feedCalls).toBe(0)
  })

  it('treats a missing weightedScore as null, not zero', async () => {
    const row = feedRow('abc')
    delete (row as { weightedScore?: number }).weightedScore
    feedRows = [row]
    const c = (await loadCallConfluence(['abc'], { loadFeed: feedLoader })).get('abc')
    expect(c?.weightedScore).toBeNull()
  })
})

describe('clearsConfluence', () => {
  const conf = (over: Partial<CallConfluence>): CallConfluence => ({
    contract: 'x',
    groups: ['A', 'B'],
    groupCount: 2,
    mentions: 3,
    weightedScore: null,
    kinds: [],
    trustedGroups: [],
    available: true,
    ...over,
  })

  it('passes at the bar', () => {
    expect(clearsConfluence(conf({ groupCount: 2 }), 2).pass).toBe(true)
    expect(clearsConfluence(conf({ groupCount: 1 }), 2).pass).toBe(false)
  })

  it('trusted-only counting is stricter than raw group count', () => {
    const c = conf({ groupCount: 3, trustedGroups: ['A'] })
    expect(clearsConfluence(c, 2).pass).toBe(true)
    expect(clearsConfluence(c, 2, true).pass).toBe(false)
  })

  it('refuses an unavailable feed instead of fabricating a pass', () => {
    const r = clearsConfluence(conf({ available: false, groupCount: 0 }), 2)
    expect(r.pass).toBe(false)
    expect(r.detail).toContain('unavailable')
  })

  it('refuses an undefined entry', () => {
    expect(clearsConfluence(undefined, 2).pass).toBe(false)
  })

  it('reports the counted groups against the bar', () => {
    expect(clearsConfluence(conf({ groupCount: 3 }), 2).detail).toContain('3 group(s)')
    expect(clearsConfluence(conf({ groupCount: 1 }), 2).detail).toContain('below bar')
  })
})

describe('describeConfluence', () => {
  it('names the unavailable and empty states honestly', () => {
    const base: CallConfluence = {
      contract: 'x', groups: [], groupCount: 0, mentions: 0,
      weightedScore: null, kinds: [], trustedGroups: [], available: false,
    }
    expect(describeConfluence(base)).toBe('call groups: no call-feed entry')
    expect(describeConfluence({ ...base, available: true })).toBe(
      'call groups: entry present but no group named',
    )
  })

  it('renders groups, score and mentions', () => {
    expect(
      describeConfluence({
        contract: 'x', groups: ['A', 'B'], groupCount: 2, mentions: 7,
        weightedScore: 8, kinds: [], trustedGroups: [], available: true,
      }),
    ).toBe('call groups (2): A, B · score 8.0 · 7 mention(s)')
  })
})

describe('strategy-intake confluence gate', () => {
  // The gate is a property of the intake, not of the confluence maths: these
  // assert the WIRING (an explicit fire + an explicit bar), because a bar that
  // is computed but never applied is the failure mode worth catching.
  it('keeps confluence as evidence when no bar is configured', () => {
    const r = applyConfluenceBar([verdict()], EMPTY_CONFLUENCE('x'), undefined)
    expect(r.fired).not.toBeNull()
    expect(r.bar).toBeNull()
    expect(r.refusals).toEqual([])
  })

  it('drops the firing strategy when the bar is not cleared', () => {
    const conf: CallConfluence = {
      contract: 'x', groups: ['A'], groupCount: 1, mentions: 3,
      weightedScore: 5, kinds: [], trustedGroups: [], available: true,
    }
    const r = applyConfluenceBar([verdict()], conf, { minGroups: 2 })
    expect(r.fired).toBeNull()
    expect(r.bar?.pass).toBe(false)
    expect(r.refusals.some((l) => l.startsWith('Call confluence'))).toBe(true)
  })

  it('keeps the strategy when the bar is cleared, and trusted-only is stricter', () => {
    const conf: CallConfluence = {
      contract: 'x', groups: ['A', 'B'], groupCount: 2, mentions: 4,
      weightedScore: 7, kinds: [], trustedGroups: ['A'], available: true,
    }
    expect(applyConfluenceBar([verdict()], conf, { minGroups: 2 }).fired).not.toBeNull()
    const strict = applyConfluenceBar([verdict()], conf, { minGroups: 2, trustedOnly: true })
    expect(strict.fired).toBeNull()
  })

  it('refuses when the feed is unreadable rather than passing it', () => {
    const r = applyConfluenceBar([verdict()], EMPTY_CONFLUENCE('x'), { minGroups: 1 })
    expect(r.fired).toBeNull()
    expect(r.bar?.detail).toContain('unavailable')
  })

  it('returns null when nothing fired, with or without a bar', () => {
    expect(applyConfluenceBar([], EMPTY_CONFLUENCE('x'), { minGroups: 1 }).fired).toBeNull()
    expect(applyConfluenceBar([], EMPTY_CONFLUENCE('x'), undefined).fired).toBeNull()
  })
})
