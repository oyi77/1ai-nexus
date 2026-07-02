// ─────────────────────────────────────────────────────────────
// Market Sources Configuration
// Enable/disable providers per vertical, per tier
// ─────────────────────────────────────────────────────────────

import type { MarketVertical, ProviderConfig, SignalTier } from '@/lib/modules/market/types'
import { DEFAULT_TIER_WEIGHTS, DEFAULT_TIER_TTLS } from '@/lib/modules/market/types'

// Provider-specific config overrides
const PROVIDER_CONFIGS: Record<string, Partial<ProviderConfig>> = {
  'binance-funding': { ttlMs: 300_000 },      // 5 min (funding settles every 8h, but rate changes faster)
  'binance-oi': { ttlMs: 60_000 },            // 1 min
  'binance-liquidations': { ttlMs: 30_000 },  // 30 sec (real-time-ish)
  'binance-ls-ratio': { ttlMs: 60_000 },      // 1 min
  'binance-orderbook': { ttlMs: 5_000 },      // 5 sec
  'deribit-options': { ttlMs: 300_000 },       // 5 min
  'alternative-me': { ttlMs: 300_000 },        // 5 min
  'fred-calendar': { ttlMs: 3600_000 },        // 1 hour
  'cryptoquant-flow': { ttlMs: 900_000 },      // 15 min
  'stablecoin-flow': { ttlMs: 900_000 },       // 15 min
  'whale-alert': { ttlMs: 60_000 },            // 1 min
}

// Which providers are relevant to which verticals
const VERTICAL_PROVIDERS: Record<MarketVertical, string[]> = {
  crypto_cex: [
    'binance-funding', 'binance-oi', 'binance-liquidations',
    'binance-ls-ratio', 'binance-orderbook', 'deribit-options',
    'alternative-me', 'cryptoquant-flow', 'stablecoin-flow', 'whale-alert',
  ],
  forex: ['fred-calendar'],
  idx_bonds: ['fred-calendar'],
  commodity: ['fred-calendar'],
  binary: ['binance-funding', 'binance-oi', 'alternative-me'],
  deriv: ['binance-funding', 'binance-oi', 'deribit-options', 'alternative-me'],
}

/**
 * Get config for a specific provider
 */
export function getProviderConfig(providerId: string, tier: SignalTier): ProviderConfig {
  const overrides = PROVIDER_CONFIGS[providerId] ?? {}
  return {
    enabled: overrides.enabled ?? true,
    weight: overrides.weight ?? DEFAULT_TIER_WEIGHTS[tier],
    ttlMs: overrides.ttlMs ?? DEFAULT_TIER_TTLS[tier],
  }
}

/**
 * Check if a provider is enabled for a specific vertical
 */
export function isProviderEnabledForVertical(providerId: string, vertical: MarketVertical): boolean {
  return VERTICAL_PROVIDERS[vertical]?.includes(providerId) ?? false
}

/**
 * Get all enabled providers for a vertical
 */
export function getEnabledProviders(vertical: MarketVertical): string[] {
  return VERTICAL_PROVIDERS[vertical] ?? []
}
