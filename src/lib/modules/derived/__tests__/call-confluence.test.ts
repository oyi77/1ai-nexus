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
  type CallConfluence,
  type CallFeedRow,
} from '../call-confluence'

let feedRows: CallFeedRow[] = []
let feedBehavior: ((now: number, maxAge?: number) => Promise<CallFeedRow[]>) | null = null
let feedCalls = 0

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
