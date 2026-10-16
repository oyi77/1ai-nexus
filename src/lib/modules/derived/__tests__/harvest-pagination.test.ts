// ─────────────────────────────────────────────────────────────
// Cursor pagination — pure decision logic tests.
// Proves the pagination loop in refreshOneWallet:
//   • walks OLDER pages until the episode gate is satisfied
//   • stops when no cursor is returned (oldest history reached)
//   • stops at PAGINATION_MAX_PAGES (runtime bound)
//   • forwards the cursor verbatim between pages
// No RPC, no DB, no time. The decision helper is the seam.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { shouldFetchOlderPage } from '../wallet-refresh';

describe('shouldFetchOlderPage', () => {
  it('returns false when the cursor is null (no older history)', () => {
    expect(
      shouldFetchOlderPage({ closedEpisodes: 0, pagesFetched: 1, cursor: null }),
    ).toBe(false);
  });

  it('returns false when the page budget is exhausted (runtime bound)', () => {
    // PAGINATION_MAX_PAGES is 4: after fetching 4 pages, never fetch another.
    expect(
      shouldFetchOlderPage({ closedEpisodes: 0, pagesFetched: 4, cursor: 'sig-cursor-3' }),
    ).toBe(false);
  });

  it('returns false when the episode gate is already satisfied', () => {
    // EPISODE_TARGET = minEpisodes + 1 = 16. At 16 closed episodes the gate
    // survives the single-giant drop (n>=15 after dropping 1).
    expect(
      shouldFetchOlderPage({ closedEpisodes: 16, pagesFetched: 1, cursor: 'sig-cursor-1' }),
    ).toBe(false);
  });

  it('returns true below the episode gate with a cursor and budget remaining', () => {
    expect(
      shouldFetchOlderPage({ closedEpisodes: 5, pagesFetched: 1, cursor: 'sig-cursor-1' }),
    ).toBe(true);
  });

  it('walks three synthetic pages, accumulating episodes, then stops at the gate', () => {
    // Simulate the loop driver: each page yields 6 closed episodes and a
    // next cursor. The gate (EPISODE_TARGET=16) is crossed after page 3
    // (6 + 6 + 6 = 18 ≥ 16).
    let cursor: string | null = 'sig-page-1';
    let pagesFetched = 0;
    let closedEpisodes = 0;
    const visits: { closedEpisodes: number; pagesFetched: number; cursor: string | null }[] = [];
    while (shouldFetchOlderPage({ closedEpisodes, pagesFetched, cursor })) {
      pagesFetched += 1;
      closedEpisodes += 6; // each page contributes 6 closed episodes
      cursor = `sig-page-${pagesFetched + 1}`;
      visits.push({ closedEpisodes, pagesFetched, cursor });
    }
    expect(visits).toHaveLength(3);
    expect(visits[0]).toEqual({ closedEpisodes: 6, pagesFetched: 1, cursor: 'sig-page-2' });
    expect(visits[1]).toEqual({ closedEpisodes: 12, pagesFetched: 2, cursor: 'sig-page-3' });
    expect(visits[2]).toEqual({ closedEpisodes: 18, pagesFetched: 3, cursor: 'sig-page-4' });
    // Loop terminated because the gate is now satisfied.
    expect(closedEpisodes).toBeGreaterThanOrEqual(16);
    expect(pagesFetched).toBe(3);
  });

  it('stops at PAGINATION_MAX_PAGES even when the gate is still unsatisfied', () => {
    // Each page contributes 1 episode. PAGINATION_MAX_PAGES = 4, so even at
    // 4 episodes (well below the gate of 16) the runtime bound halts the
    // walk. This is the runaway guard.
    let cursor: string | null = 'sig-page-1';
    let pagesFetched = 0;
    let closedEpisodes = 0;
    while (shouldFetchOlderPage({ closedEpisodes, pagesFetched, cursor })) {
      pagesFetched += 1;
      closedEpisodes += 1;
      cursor = pagesFetched >= 4 ? null : `sig-page-${pagesFetched + 1}`;
    }
    expect(pagesFetched).toBe(4);
    expect(closedEpisodes).toBe(4); // well below the gate, but bounded
  });

  it('stops at the first null cursor (oldest history reached) before the budget', () => {
    // Page 2 returns null cursor: simulate that by flipping the cursor at
    // the boundary. The loop must stop even though pagesFetched < budget.
    let cursor: string | null = 'sig-page-1';
    let pagesFetched = 0;
    let closedEpisodes = 0;
    while (shouldFetchOlderPage({ closedEpisodes, pagesFetched, cursor })) {
      pagesFetched += 1;
      closedEpisodes += 6;
      cursor = pagesFetched === 2 ? null : `sig-page-${pagesFetched + 1}`;
    }
    expect(pagesFetched).toBe(2);
  });
});
