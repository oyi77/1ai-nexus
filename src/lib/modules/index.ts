// ─────────────────────────────────────────────────────────────
// NEXUS Module Registry — Auto-registration
// Import this once at app startup to register all modules
// ─────────────────────────────────────────────────────────────

import { getRegistry } from './registry'

// On-chain
import geckoterminal from './onchain/geckoterminal'
import defillama from './onchain/defillama'
import dexscreener from './onchain/dexscreener'
import hyperliquid from './onchain/hyperliquid'
import polymarket from './onchain/polymarket'
import blockscoutEth from './onchain/blockscout-eth'
import arkhamRe from './onchain/arkham-re'
import birdeyeRe from './onchain/birdeye-re'

// Market
import coingecko from './market/coingecko'
import binance from './market/binance-public'
import bybit from './market/bybit-public'
import coinpaprika from './market/coinpaprika'
import coincap from './market/coincap'

// Macro
import fred from './macro/fred'
import fearGreed from './macro/fear-greed'
import frankfurter from './macro/frankfurter'
import exchangeRate from './macro/exchangerate-api'
import ecbSdw from './macro/ecb-sdw'
import worldbank from './macro/worldbank'
import finnhubRe from './macro/finnhub-re'

// Derivatives
import derivativesAggregate from './derivatives/aggregate'

// Prediction
import manifold from './prediction/manifold'

// Equities (RE)
import yahooFinance from './equities/yahoo-finance'
import alphaVantageRe from './equities/alpha-vantage-re'
import fmpRe from './equities/fmp-re'

// Commodities (RE)
import metalsRe from './commodities/metals-re'

// Sentiment (derived + RE)
import longshortDerived from './sentiment/longshort-derived'
import lunarcrushRe from './sentiment/lunarcrush-re'
import santimentRe from './sentiment/santiment-re'

// AI Signals (derived)
import nexusSmartMoney from './ai-signals/nexus-internal'

// News
import rssEngine from './news/rss-engine'
import redditCrypto from './news/reddit-crypto'
import cryptopanicRe from './news/cryptopanic-re'
import benzingaRe from './news/benzinga-re'

/** Register all built-in modules. Call once at startup. */
export function registerAllModules() {
  const registry = getRegistry()

  registry.registerAll([
    // On-chain
    geckoterminal,
    defillama,
    dexscreener,
    hyperliquid,
    polymarket,
    blockscoutEth,
    arkhamRe,
    birdeyeRe,
    // Market
    coingecko,
    binance,
    bybit,
    coinpaprika,
    coincap,
    // Macro
    fred,
    fearGreed,
    frankfurter,
    exchangeRate,
    ecbSdw,
    worldbank,
    finnhubRe,
    // Derivatives
    derivativesAggregate,
    // Prediction
    manifold,
    // Equities (RE)
    yahooFinance,
    alphaVantageRe,
    fmpRe,
    // Commodities (RE)
    metalsRe,
    // Sentiment (derived + RE)
    longshortDerived,
    lunarcrushRe,
    santimentRe,
    // AI Signals (derived)
    nexusSmartMoney,
    // News
    rssEngine,
    redditCrypto,
    cryptopanicRe,
    benzingaRe,
  ])

  return registry
}

// Re-export registry access
export { getRegistry } from './registry'
export type { DataModule, DataCategory, SourceType, ModuleResult, FetchParams } from './types'
