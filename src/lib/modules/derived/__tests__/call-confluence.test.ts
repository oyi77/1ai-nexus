// Tests for call-group confluence.
//
// The feed loader is injected through `opts.loadFeed` (the module's own seam),
// so the rejection path runs through the same try/catch production uses —
// no module-internals mocking.
import { afterEach, describe, expect, it } from 'vitest'
import {
  loadCallConfluence,
  clearsConfluence,
  clearsRawGroups,
  describeConfluence,
  EMPTY_CONFLUENCE,
  type CallConfluence,
  type CallFeedRow,
} from '../call-confluence'
import type { CallFeedRead } from '../db-call-feed'
import { applyConfluenceBar, evaluateStrategiesFor } from '../strategy-intake'
import type { StrategyVerdict } from '../strategy-evaluator'

let feedRows: CallFeedRow[] = []
let feedBehavior: ((now: number, maxAge?: number) => Promise<CallFeedRead>) | null = null
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

const feedLoader = (now: number, maxAge?: number): Promise<CallFeedRead> => {
  feedCalls++
  return feedBehavior ? feedBehavior(now, maxAge) : Promise.resolve({ rows: feedRows, readOk: true })
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
  it('marks an empty feed readable: nothing was called, but the source answered', async () => {
    feedRows = []
    const m = await loadCallConfluence(['abc'], { loadFeed: feedLoader })
    expect(m.get('abc')?.available).toBe(true)
    expect(m.get('abc')?.present).toBe(false)
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

  it('marks entries unavailable when the source reports it could not be read', async () => {
    // A dead or expired artifact yields no rows AND readOk:false. Flipping
    // `available` on it would turn "we could not look" into "nobody called it".
    feedRows = []
    feedBehavior = async () => ({ rows: [], readOk: false })
    const m = await loadCallConfluence(['abc'], { loadFeed: feedLoader })
    expect(m.get('abc')?.available).toBe(false)
    expect(clearsConfluence(m.get('abc'), 2).detail).toContain('unreadable')
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

  it('reports an unmentioned contract as absent, not as an unreadable feed', async () => {
    feedRows = [feedRow('known')]
    const m = await loadCallConfluence(['known', 'unknown'], { loadFeed: feedLoader })
    expect(m.get('known')?.available).toBe(true)
    expect(m.get('known')?.present).toBe(true)
    expect(m.get('unknown')?.available).toBe(true)
    expect(m.get('unknown')?.present).toBe(false)
  })

  it('reads the feed once for the whole batch', async () => {
    await loadCallConfluence(['a', 'b', 'c'], { loadFeed: feedLoader })
    expect(feedCalls).toBe(1)
  })

  it('skips the feed entirely for an empty contract list', async () => {
    await loadCallConfluence([], { loadFeed: feedLoader })
    expect(feedCalls).toBe(0)
  })

  it('weights each group by origin rate and clamps hub weights to one vote', async () => {
    feedRows = [
      feedRow('abc', {
        sources: ['CallAnalyser2', '@whaleBuyBotFree', 'Unmeasured'],
        callerWeights: {
          CallAnalyser2: 1.5,
          whaleBuyBotFree: 0.15,
          Unmeasured: 0.4,
          'not-a-source': 1.2,
        },
      }),
    ]
    const c = (await loadCallConfluence(['abc'], { loadFeed: feedLoader })).get('abc')
    // 1.0 (hub clamped) + 0.15 (mirror) + 0.4 (measured elsewhere) = 1.55
    expect(c?.groupCount).toBe(3)
    expect(c?.effectiveGroupCount).toBeCloseTo(1.55, 5)
  })

  it('prices an unmeasured group below a measured one, never as a full vote', async () => {
    // Two states were wrong: a silent 1.0 let an unmeasured channel (possibly
    // a pure mirror) tie with a verified origin, and a 0 made it invisible -
    // the operator could not tell "nobody else called it" from "I have no
    // measurement for the group that did". 0.25 keeps it strictly below any
    // measured group while staying visible in the count.
    const row = feedRow('abc', { sources: ['NoScoreGroup'] })
    delete (row as { callerWeights?: Record<string, number> }).callerWeights
    feedRows = [row]
    const c = (await loadCallConfluence(['abc'], { loadFeed: feedLoader })).get('abc')
    expect(c?.groupCount).toBe(1)
    expect(c?.effectiveGroupCount).toBeCloseTo(0.25, 5)
    expect(clearsConfluence(c, 1).pass).toBe(false)
  })

  it('does not reach a two-group bar with one measured and one unmeasured group', async () => {
    feedRows = [
      feedRow('abc', {
        sources: ['CallAnalyser2', 'NoScoreGroup'],
        callerWeights: { CallAnalyser2: 1.5 },
      }),
    ]
    const c = (await loadCallConfluence(['abc'], { loadFeed: feedLoader })).get('abc')
    expect(c?.effectiveGroupCount).toBeCloseTo(1.25, 5)
    expect(clearsConfluence(c, 2).pass).toBe(false)
  })

  it('treats a missing weightedScore as null, not zero', async () => {
    const row = feedRow('abc')
    delete (row as { weightedScore?: number }).weightedScore
    feedRows = [row]
    const c = (await loadCallConfluence(['abc'], { loadFeed: feedLoader })).get('abc')
    expect(c?.weightedScore).toBeNull()
  })
})

const confOf = (over: Partial<CallConfluence> = {}): CallConfluence => ({
  contract: 'x',
  groups: ['A', 'B'],
  groupCount: 2,
  mentions: 3,
  weightedScore: null,
  kinds: [],
  trustedGroups: [],
  effectiveGroupCount: 2,
  available: true,
  present: true,
  ...over,
})

describe('clearsConfluence', () => {
  const conf = confOf

  it('passes at the bar', () => {
    expect(clearsConfluence(conf({ groupCount: 2, effectiveGroupCount: 2 }), 2).pass).toBe(true)
    expect(clearsConfluence(conf({ groupCount: 1, effectiveGroupCount: 1 }), 2).pass).toBe(false)
  })

  it('discounts a mirror group instead of counting it as a full vote', () => {
    // Measured 2026-10-22: whaleBuyBotFree originated 0 of its 263 calls
    // (weight 0.15) while CallAnalyser2 originated 93.1% of 5,341 (1.5).
    // Both called the token, yet that is NOT two independent confirmations:
    // the mirror merely re-broadcast the hub.
    const mirrored = conf({ groupCount: 2, effectiveGroupCount: 1.15 })
    expect(clearsConfluence(mirrored, 2).pass).toBe(false)
    expect(clearsConfluence(mirrored, 1).pass).toBe(true)
    const independent = conf({ groupCount: 2, effectiveGroupCount: 2 })
    expect(clearsConfluence(independent, 2).pass).toBe(true)
  })

  it('trusted-only counting is stricter than raw group count', () => {
    const c = conf({ groupCount: 3, trustedGroups: ['A'] })
    expect(clearsConfluence(c, 2).pass).toBe(true)
    expect(clearsConfluence(c, 2, true).pass).toBe(false)
  })

  it('refuses an unreadable feed instead of fabricating a pass', () => {
    const r = clearsConfluence(conf({ available: false, present: false, groupCount: 0 }), 2)
    expect(r.pass).toBe(false)
    expect(r.detail).toContain('unreadable')
  })

  it('distinguishes "no group called it" from "the feed is dead"', () => {
    // Both refuse, but the operator's next move is opposite: a fresh feed
    // with no entry means the CA was never called; an unreadable feed means
    // the harvester is broken. Same label would hide that.
    const absent = clearsConfluence(conf({ present: false, groups: [], groupCount: 0, effectiveGroupCount: 0 }), 2)
    expect(absent.pass).toBe(false)
    expect(absent.detail).toContain('no call group flagged it')
    expect(absent.detail).not.toContain('unreadable')
  })

  it('refuses an undefined entry', () => {
    expect(clearsConfluence(undefined, 2).pass).toBe(false)
  })

  it('reports the counted groups against the bar', () => {
    expect(clearsConfluence(conf({ groupCount: 3, effectiveGroupCount: 3 }), 2).detail).toContain(
      '3 group(s)',
    )
    expect(clearsConfluence(conf({ groupCount: 1, effectiveGroupCount: 1 }), 2).detail).toContain(
      'below bar',
    )
  })
})

describe('describeConfluence', () => {
  it('names the unavailable and empty states honestly', () => {
    const base: CallConfluence = {
      contract: 'x', groups: [], groupCount: 0, mentions: 0,
      weightedScore: null, kinds: [], trustedGroups: [], effectiveGroupCount: 0,
      available: false, present: false,
    }
    expect(describeConfluence(base)).toBe('call groups: feed unreadable')
    expect(describeConfluence({ ...base, available: true })).toBe('call groups: none flagged it')
    expect(describeConfluence({ ...base, available: true, present: true })).toBe(
      'call groups: entry present but no group named',
    )
  })

  it('renders groups, score and mentions', () => {
    expect(
      describeConfluence(confOf({ contract: 'x', groups: ['A', 'B'], groupCount: 2, mentions: 7, weightedScore: 8 })),
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
    const conf = confOf({ effectiveGroupCount: 1, groups: ['A'], groupCount: 1 })
    const r = applyConfluenceBar([verdict()], conf, { minGroups: 2 })
    expect(r.fired).toBeNull()
    expect(r.bar?.pass).toBe(false)
    expect(r.refusals.some((l) => l.startsWith('Call confluence'))).toBe(true)
  })

  it('keeps the strategy when the bar is cleared, and trusted-only is stricter', () => {
    const conf = confOf({ trustedGroups: ['A'] })
    expect(applyConfluenceBar([verdict()], conf, { minGroups: 2 }).fired).not.toBeNull()
    const strict = applyConfluenceBar([verdict()], conf, { minGroups: 2, trustedOnly: true })
    expect(strict.fired).toBeNull()
  })

  it('refuses when the feed is unreadable rather than passing it', () => {
    const r = applyConfluenceBar([verdict()], EMPTY_CONFLUENCE('x'), { minGroups: 1 })
    expect(r.fired).toBeNull()
    expect(r.bar?.detail).toContain('unreadable')
  })

  it('returns null when nothing fired, with or without a bar', () => {
    expect(applyConfluenceBar([], EMPTY_CONFLUENCE('x'), { minGroups: 1 }).fired).toBeNull()
    expect(applyConfluenceBar([], EMPTY_CONFLUENCE('x'), undefined).fired).toBeNull()
  })

  it('raw basis counts a mirror group the effective basis discounts to zero', () => {
    const mirror = confOf({ groups: ['whaleBuyBotFree'], groupCount: 1, effectiveGroupCount: 0 })
    expect(applyConfluenceBar([verdict()], mirror, { minGroups: 1 }).fired).toBeNull()
    const raw = applyConfluenceBar([verdict()], mirror, { minGroups: 1 }, 'raw')
    expect(raw.fired).not.toBeNull()
    expect(raw.bar?.detail).toContain('raw count')
  })

  it('raw basis still refuses an unreadable feed and an unmentioned contract', () => {
    expect(applyConfluenceBar([verdict()], EMPTY_CONFLUENCE('x'), { minGroups: 1 }, 'raw').fired).toBeNull()
    const absent = confOf({ present: false, groups: [], groupCount: 0, effectiveGroupCount: 0 })
    expect(applyConfluenceBar([verdict()], absent, { minGroups: 1 }, 'raw').fired).toBeNull()
  })
})

describe('clearsRawGroups', () => {
  // The raw basis exists for one reason: an operator who names the groups by
  // hand wants a named group to count even when the caller weighting has
  // zeroed it. These pin that it stays a COUNT of names, never a discount.
  it('counts group names, so a weighted-out mirror still satisfies the bar', () => {
    const mirror = confOf({ groups: ['whaleBuyBotFree'], groupCount: 1, effectiveGroupCount: 0 })
    expect(clearsRawGroups(mirror, 1).pass).toBe(true)
    expect(clearsConfluence(mirror, 1).pass).toBe(false)
  })

  it('still refuses an unreadable feed and an unmentioned contract', () => {
    const dead = clearsRawGroups(confOf({ available: false, present: false, groupCount: 0 }), 1)
    expect(dead.pass).toBe(false)
    expect(dead.detail).toContain('unreadable')
    const absent = clearsRawGroups(confOf({ present: false, groups: [], groupCount: 0 }), 1)
    expect(absent.pass).toBe(false)
    expect(absent.detail).toContain('no call group flagged it')
    expect(clearsRawGroups(undefined, 1).pass).toBe(false)
  })

  it('trusted-only narrows the raw count to the named groups', () => {
    const c = confOf({ groups: ['A', 'B', 'C'], groupCount: 3, trustedGroups: ['A'] })
    expect(clearsRawGroups(c, 3).pass).toBe(true)
    expect(clearsRawGroups(c, 3, true).pass).toBe(false)
    expect(clearsRawGroups(c, 1, true).pass).toBe(true)
  })

  it('labels the basis so a raw pass can never be read as a weighted one', () => {
    expect(clearsRawGroups(confOf({ groupCount: 2 }), 2).detail).toContain('raw count')
    expect(clearsConfluence(confOf({ groupCount: 2, effectiveGroupCount: 2 }), 2).detail).not.toContain('raw')
  })
})

describe('batch confluence seam', () => {
  it('uses the injected confluence and never reads the feed', async () => {
    const feedLoaderCalls = { n: 0 }
    const seam = () => {
      feedLoaderCalls.n++
      return Promise.resolve({ rows: [], readOk: true })
    }
    const precomputed = confOf({ groups: ['A', 'B', 'C'], groupCount: 3, effectiveGroupCount: 3 })
    // Any real fetch attempt rejects, so the test never touches the network
    // while still exercising the intake's failure-tolerant legs.
    const fetchFn = (() => {
      return Promise.reject(new Error('network disabled in test'))
    }) as unknown as typeof fetch
    const out = await evaluateStrategiesFor({
      contract: 'x',
      buyers: [],
      buyerStatus: new Map(),
      market: null,
      fetchFn,
      callFeedSeam: seam,
      confluence: precomputed,
    })
    expect(feedLoaderCalls.n).toBe(0)
    expect(out.confluence).toBe(precomputed)
    expect(out.confluence.groupCount).toBe(3)
  })
})
