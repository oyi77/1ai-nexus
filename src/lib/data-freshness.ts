export type DataSourceId =
  | 'defillama'
  | 'jupiter'
  | 'geckoterminal'
  | 'coinpaprika'
  | 'cryptocompare'
  | 'lunarcrush'
  | 'coingecko'
  | 'dexscreener'
  | 'polymarket'
  | 'blockstream'
  | 'reservoir'
  | 'alchemy'
  | 'helius'
  | 'etherscan'
  | 'cex-binance'
  | 'cex-bybit'
  | 'cex-okx'
  | 'cex-hyperliquid'
  | 'cex-kraken';

export type FreshnessStatus = 'fresh' | 'stale' | 'very_stale' | 'no_data' | 'disabled' | 'error';

export type SourceCategory =
  | 'DeFi'
  | 'Pricing'
  | 'DEX'
  | 'Market'
  | 'Social'
  | 'Predictions'
  | 'Bitcoin'
  | 'NFT'
  | 'RPC'
  | 'CEX';

export interface DataSourceState {
  id: DataSourceId;
  name: string;
  category: SourceCategory;
  lastUpdate: Date | null;
  lastError: string | null;
  itemCount: number;
  enabled: boolean;
  status: FreshnessStatus;
  latencyMs: number | null;
  requiredForCore: boolean;
}

export interface DataFreshnessSummary {
  totalSources: number;
  activeSources: number;
  staleSources: number;
  errorSources: number;
  overallStatus: 'sufficient' | 'limited' | 'insufficient';
  coveragePercent: number;
}

type FreshnessListener = (summary: DataFreshnessSummary) => void;

interface SourceMetadata {
  name: string;
  category: SourceCategory;
  requiredForCore: boolean;
  enabled: boolean;
}

const FRESH_THRESHOLD_MS = 15 * 60 * 1000;   // 15 minutes
const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
const VERY_STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6 hours

const SOURCE_METADATA: Record<DataSourceId, SourceMetadata> = {
  defillama:     { name: 'DefiLlama',       category: 'DeFi',        requiredForCore: true,  enabled: true },
  jupiter:       { name: 'Jupiter',          category: 'Pricing',     requiredForCore: true,  enabled: true },
  geckoterminal: { name: 'GeckoTerminal',    category: 'DEX',         requiredForCore: false, enabled: true },
  coinpaprika:   { name: 'CoinPaprika',      category: 'Market',      requiredForCore: true,  enabled: true },
  cryptocompare: { name: 'CryptoCompare',    category: 'Market',      requiredForCore: false, enabled: true },
  lunarcrush:    { name: 'LunarCrush',       category: 'Social',      requiredForCore: false, enabled: true },
  coingecko:     { name: 'CoinGecko',        category: 'Market',      requiredForCore: false, enabled: true },
  dexscreener:   { name: 'DEX Screener',     category: 'DEX',         requiredForCore: false, enabled: true },
  polymarket:    { name: 'Polymarket',        category: 'Predictions', requiredForCore: false, enabled: true },
  blockstream:   { name: 'Blockstream',       category: 'Bitcoin',     requiredForCore: false, enabled: true },
  reservoir:     { name: 'Reservoir',         category: 'NFT',         requiredForCore: false, enabled: true },
  alchemy:       { name: 'Alchemy',           category: 'RPC',         requiredForCore: false, enabled: false },
  helius:        { name: 'Helius',            category: 'RPC',         requiredForCore: false, enabled: false },
  etherscan:     { name: 'Etherscan',         category: 'RPC',         requiredForCore: false, enabled: false },
  'cex-binance': { name: 'Binance CEX',       category: 'CEX',         requiredForCore: true,  enabled: true },
  'cex-bybit':   { name: 'Bybit CEX',         category: 'CEX',         requiredForCore: true,  enabled: true },
  'cex-okx':     { name: 'OKX CEX',           category: 'CEX',         requiredForCore: false, enabled: true },
  'cex-hyperliquid': { name: 'Hyperliquid',   category: 'CEX',         requiredForCore: false, enabled: true },
  'cex-kraken':  { name: 'Kraken CEX',        category: 'CEX',         requiredForCore: false, enabled: true },
};

function computeStatus(source: DataSourceState): FreshnessStatus {
  if (!source.enabled) return 'disabled';
  if (source.lastError) return 'error';
  if (!source.lastUpdate) return 'no_data';

  const age = Date.now() - source.lastUpdate.getTime();
  if (age < FRESH_THRESHOLD_MS) return 'fresh';
  if (age < STALE_THRESHOLD_MS) return 'stale';
  if (age < VERY_STALE_THRESHOLD_MS) return 'very_stale';
  return 'very_stale';
}

export class DataFreshnessTracker {
  private sources: Map<DataSourceId, DataSourceState>;
  private listeners: Set<FreshnessListener>;

  constructor() {
    this.sources = new Map();
    this.listeners = new Set();

    for (const [id, meta] of Object.entries(SOURCE_METADATA) as [DataSourceId, SourceMetadata][]) {
      const state: DataSourceState = {
        id,
        name: meta.name,
        category: meta.category,
        lastUpdate: null,
        lastError: null,
        itemCount: 0,
        enabled: meta.enabled,
        status: meta.enabled ? 'no_data' : 'disabled',
        latencyMs: null,
        requiredForCore: meta.requiredForCore,
      };
      this.sources.set(id, state);
    }
  }

  recordUpdate(sourceId: DataSourceId, itemCount: number, latencyMs: number): void {
    const source = this.sources.get(sourceId);
    if (!source) return;

    source.lastUpdate = new Date();
    source.lastError = null;
    source.itemCount = itemCount;
    source.latencyMs = latencyMs;
    source.status = computeStatus(source);

    this.notifyListeners();
  }

  recordError(sourceId: DataSourceId, error: string): void {
    const source = this.sources.get(sourceId);
    if (!source) return;

    source.lastError = error;
    source.status = computeStatus(source);

    this.notifyListeners();
  }

  getSource(sourceId: DataSourceId): DataSourceState | undefined {
    return this.sources.get(sourceId);
  }

  getAllSources(): DataSourceState[] {
    return Array.from(this.sources.values());
  }

  getSummary(): DataFreshnessSummary {
    const all = this.getAllSources();
    const enabled = all.filter((s) => s.enabled);
    const active = enabled.filter((s) => s.status === 'fresh' || s.status === 'stale');
    const stale = enabled.filter((s) => s.status === 'stale' || s.status === 'very_stale');
    const errors = enabled.filter((s) => s.status === 'error');

    const coreSources = enabled.filter((s) => s.requiredForCore);
    const activeCore = coreSources.filter((s) => s.status === 'fresh' || s.status === 'stale');

    const coveragePercent = enabled.length > 0
      ? Math.round((active.length / enabled.length) * 100)
      : 0;

    const coreActivePercent = coreSources.length > 0
      ? activeCore.length / coreSources.length
      : 0;

    let overallStatus: 'sufficient' | 'limited' | 'insufficient';
    if (coreActivePercent >= 0.5 && coveragePercent >= 50) {
      overallStatus = 'sufficient';
    } else if (coreActivePercent > 0) {
      overallStatus = 'limited';
    } else {
      overallStatus = 'insufficient';
    }

    return {
      totalSources: enabled.length,
      activeSources: active.length,
      staleSources: stale.length,
      errorSources: errors.length,
      overallStatus,
      coveragePercent,
    };
  }

  hasSufficientData(): boolean {
    const enabled = this.getAllSources().filter((s) => s.enabled);
    const coreSources = enabled.filter((s) => s.requiredForCore);
    if (coreSources.length === 0) return false;

    const activeCore = coreSources.filter((s) => s.status === 'fresh' || s.status === 'stale');
    return activeCore.length / coreSources.length >= 0.5;
  }

  subscribe(callback: FreshnessListener): void {
    this.listeners.add(callback);
  }

  unsubscribe(callback: FreshnessListener): void {
    this.listeners.delete(callback);
  }

  private notifyListeners(): void {
    const summary = this.getSummary();
    for (const listener of this.listeners) {
      listener(summary);
    }
  }
}

export const freshnessTracker = new DataFreshnessTracker();
