// ─────────────────────────────────────────────────────────────
// NEXUS Module Registry — Auto-registration
// 44 modules across 12 data categories
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
import mempoolSpace from './onchain/mempool-space'
import l2beat from './onchain/l2beat'
import blockchair from './onchain/blockchair'
import covalent from './onchain/covalent'

// Market
import coingecko from './market/coingecko'
import binance from './market/binance-public'
import bybit from './market/bybit-public'
import coinpaprika from './market/coinpaprika'
import coincap from './market/coincap'
import indodax from './market/indodax'

// Macro
import fred from './macro/fred'
import fearGreed from './macro/fear-greed'
import frankfurter from './macro/frankfurter'
import exchangeRate from './macro/exchangerate-api'
import ecbSdw from './macro/ecb-sdw'
import worldbank from './macro/worldbank'
import finnhubRe from './macro/finnhub-re'
import secEdgar from './macro/sec-edgar'
import dbnomics from './macro/dbnomics'
import usTreasury from './macro/us-treasury'

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
import githubApi from './sentiment/github'

// Governance
import snapshot from './governance/snapshot'

// AI Signals (derived)
import nexusSmartMoney from './ai-signals/nexus-internal'

// News
import rssEngine from './news/rss-engine'
import redditCrypto from './news/reddit-crypto'
import cryptopanicRe from './news/cryptopanic-re'
import benzingaRe from './news/benzinga-re'
import gdelt from './news/gdelt'

/** Register all 44 built-in modules. Call once at startup. */
export function registerAllModules() {
  const registry = getRegistry()

  registry.registerAll([
    // On-chain (12)
    geckoterminal, defillama, dexscreener, hyperliquid, polymarket,
    blockscoutEth, arkhamRe, birdeyeRe, mempoolSpace, l2beat, blockchair, covalent,
    // Market (6)
    coingecko, binance, bybit, coinpaprika, coincap, indodax,
    // Macro (10)
    fred, fearGreed, frankfurter, exchangeRate, ecbSdw, worldbank,
    finnhubRe, secEdgar, dbnomics, usTreasury,
    // Derivatives (1)
    derivativesAggregate,
    // Prediction (1)
    manifold,
    // Equities RE (3)
    yahooFinance, alphaVantageRe, fmpRe,
    // Commodities RE (1)
    metalsRe,
    // Sentiment (4)
    longshortDerived, lunarcrushRe, santimentRe, githubApi,
    // Governance (1)
    snapshot,
    // AI Signals (1)
    nexusSmartMoney,
    // News (5)
    rssEngine, redditCrypto, cryptopanicRe, benzingaRe, gdelt,
  ])

  return registry
}

export { getRegistry } from './registry'
export type { DataModule, DataCategory, SourceType, ModuleResult, FetchParams } from './types'
