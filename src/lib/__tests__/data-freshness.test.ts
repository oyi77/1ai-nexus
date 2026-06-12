import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DataFreshnessTracker } from '../data-freshness';

describe('DataFreshnessTracker', () => {
  let tracker: InstanceType<typeof DataFreshnessTracker>;

  beforeEach(() => {
    vi.useFakeTimers();
    tracker = new DataFreshnessTracker();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('freshness status calculation', () => {
    it('reports "fresh" immediately after recordUpdate', () => {
      tracker.recordUpdate('coingecko', 100, 50);
      expect(tracker.getSource('coingecko')?.status).toBe('fresh');
    });

    it('reports "error" when recordError is called on a previously fresh source', () => {
      tracker.recordUpdate('coingecko', 100, 50);
      expect(tracker.getSource('coingecko')?.status).toBe('fresh');

      tracker.recordError('coingecko', 'API timeout');
      const source = tracker.getSource('coingecko');
      expect(source?.status).toBe('error');
      expect(source?.lastError).toBe('API timeout');
    });

    it('clears error on subsequent recordUpdate', () => {
      tracker.recordError('coingecko', 'timeout');
      expect(tracker.getSource('coingecko')?.status).toBe('error');

      tracker.recordUpdate('coingecko', 50, 30);
      const source = tracker.getSource('coingecko');
      expect(source?.status).toBe('fresh');
      expect(source?.lastError).toBeNull();
    });

    it('reports "no_data" for enabled source that has never been updated', () => {
      // coingecko is enabled by default in SOURCE_METADATA
      const source = tracker.getSource('coingecko');
      expect(source?.status).toBe('no_data');
    });

    it('reports "disabled" for sources disabled by default (alchemy, helius, etherscan)', () => {
      expect(tracker.getSource('alchemy')?.status).toBe('disabled');
      expect(tracker.getSource('helius')?.status).toBe('disabled');
      expect(tracker.getSource('etherscan')?.status).toBe('disabled');
    });

    it('stores latency and itemCount from recordUpdate', () => {
      tracker.recordUpdate('coingecko', 42, 123);
      const source = tracker.getSource('coingecko');
      expect(source?.itemCount).toBe(42);
      expect(source?.latencyMs).toBe(123);
    });
  });

  describe('hasSufficientData', () => {
    it('returns false when no core sources are active', () => {
      expect(tracker.hasSufficientData()).toBe(false);
    });

    it('returns true when >= 50% core sources are active', () => {
      // Core sources: defillama, jupiter, coinpaprika, cex-binance, cex-bybit (5 total)
      tracker.recordUpdate('defillama', 200, 30);
      tracker.recordUpdate('jupiter', 150, 40);
      tracker.recordUpdate('coinpaprika', 100, 20);
      // 3/5 = 60% >= 50%
      expect(tracker.hasSufficientData()).toBe(true);
    });

    it('returns false when < 50% core sources are active', () => {
      // Only 2 of 5 core sources
      tracker.recordUpdate('defillama', 200, 30);
      tracker.recordUpdate('jupiter', 150, 40);
      // 2/5 = 40% < 50%
      expect(tracker.hasSufficientData()).toBe(false);
    });

    it('returns false when a core source errors', () => {
      tracker.recordUpdate('defillama', 200, 30);
      tracker.recordUpdate('jupiter', 150, 40);
      tracker.recordUpdate('coinpaprika', 100, 20);
      expect(tracker.hasSufficientData()).toBe(true);

      // Error on one core source — now only 2/5 active
      tracker.recordError('jupiter', 'down');
      expect(tracker.hasSufficientData()).toBe(false);
    });
  });

  describe('subscriber notification', () => {
    it('notifies subscribers when a source is updated', () => {
      const listener = vi.fn();
      tracker.subscribe(listener);

      tracker.recordUpdate('coingecko', 100, 50);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ totalSources: expect.any(Number) }),
      );
    });

    it('notifies subscribers when a source errors', () => {
      const listener = vi.fn();
      tracker.subscribe(listener);

      tracker.recordError('coingecko', 'timeout');
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('stops notifying after unsubscribe', () => {
      const listener = vi.fn();
      tracker.subscribe(listener);
      tracker.recordUpdate('coingecko', 100, 50);
      expect(listener).toHaveBeenCalledTimes(1);

      tracker.unsubscribe(listener);
      tracker.recordUpdate('coingecko', 200, 60);
      expect(listener).toHaveBeenCalledTimes(1); // no additional call
    });
  });

  describe('getSummary', () => {
    it('reports sufficient status when enough sources are active', () => {
      // Core sources: defillama, jupiter, coinpaprika, cex-binance, cex-bybit (5 total)
      // Need >= 3 core active (60%) + coverage >= 50% (need >= 8 of 16 enabled)
      tracker.recordUpdate('defillama', 200, 30);
      tracker.recordUpdate('jupiter', 150, 40);
      tracker.recordUpdate('coinpaprika', 100, 50);
      tracker.recordUpdate('cex-binance', 50, 25);
      // Activate non-core sources to boost coverage
      tracker.recordUpdate('coingecko', 80, 20);
      tracker.recordUpdate('dexscreener', 60, 15);
      tracker.recordUpdate('blockstream', 40, 25);
      tracker.recordUpdate('cryptocompare', 30, 10);

      const summary = tracker.getSummary();
      expect(summary.overallStatus).toBe('sufficient');
      expect(summary.activeSources).toBeGreaterThanOrEqual(8);
    });

    it('reports insufficient when no sources are active', () => {
      const summary = tracker.getSummary();
      expect(summary.overallStatus).toBe('insufficient');
      expect(summary.activeSources).toBe(0);
    });

    it('reports limited when some but not enough sources are active', () => {
      // Only 1 core source active and low coverage
      tracker.recordUpdate('coinpaprika', 100, 50);

      const summary = tracker.getSummary();
      expect(summary.overallStatus).toBe('limited');
    });

    it('coveragePercent reflects active/enabled ratio', () => {
      // Activate a known number of sources
      tracker.recordUpdate('defillama', 100, 10);
      tracker.recordUpdate('jupiter', 100, 10);
      tracker.recordUpdate('coinpaprika', 100, 10);
      tracker.recordUpdate('coingecko', 100, 10);

      const summary = tracker.getSummary();
      // 16 enabled sources total (19 total - 3 disabled)
      expect(summary.totalSources).toBe(16);
      expect(summary.activeSources).toBe(4);
      expect(summary.coveragePercent).toBe(Math.round((4 / 16) * 100));
    });
  });
});
