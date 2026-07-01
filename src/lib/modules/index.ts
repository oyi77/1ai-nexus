// ─────────────────────────────────────────────────────────────
// NEXUS Module Registry — Auto-registration
// 57 modules across 12+ data categories
// ─────────────────────────────────────────────────────────────

import { getRegistry } from './registry'

// On-chain
import geckoterminal from './onchain/geckoterminal'
import defillama from './onchain/defillama'
import dexscreener from './onchain/dexscreener'
import hyperliquid from './onchain/hyperliquid'
import polymarket from './onchain/polymarket'
import blockscoutEth from './onchain/blockscout'
import arkhamRe from './onchain/arkham'
import birdeyeRe from './onchain/birdeye'
import mempoolSpace from './onchain/mempool'
import l2beat from './onchain/l2beat'
import blockchair from './onchain/blockchair'
import covalent from './onchain/covalent'
import cycleIndicators from './chain/cycle-indicators'

// Market
import coingecko from './market/coingecko'
import binance from './market/binance'
import bybit from './market/bybit'
import coinpaprika from './market/coinpaprika'
import coincap from './market/coincap'
import indodax from './market/indodax'
import sectorsApp from './market/sectors-app'
import eastmoney from './market/eastmoney'
import marketFlow from './market/market-flow'

// Macro
import {
  fred,
  frankfurter,
  exchangeRate,
  ecbSdw,
  worldbank,
  finnhubRe,
  secEdgar,
  dbnomics,
  usTreasury,
  usgsEarthquakes,
  gdacsAlerts,
  openMeteo,
  nasaEonet,
  reliefweb,
  adsbFlight,
  openfema,
  bankOfCanada,
  ukOns,
  imfSdmx,
  indonesiaMacro,
  bisSdmx,
  eurostat,
} from './macro'
import fearGreed from './sentiment/alternative-me/fear-greed'

// Derivatives
import derivativesAggregate from './derivatives/aggregate'
import deribitOptions from './derivatives/deribit/options'
import binanceFutures from './derivatives/binance/futures'

// Prediction
import manifold from './prediction/manifold/markets'
import polymarketGamma from './prediction/polymarket/markets'

// Equities (RE)
import yahooFinance from './equities/yahoo/quotes'
import alphaVantageRe from './equities/alpha-vantage/prices'
import fmpRe from './equities/fmp/prices'
import secEdgarInsider from './equities/sec-edgar/filings'

// Commodities (RE)
import metalsRe from './commodities/metals/prices'

// Sentiment
import longshortDerived from './sentiment/longshort-derived'
import lunarcrushRe from './sentiment/lunarcrush/sentiment'
import santimentRe from './sentiment/santiment/metrics'
import githubApi from './sentiment/github/activity'
import googleTrends from './sentiment/google/trends'
import weiboHot from './sentiment/weibo/hot'
import zhihuTrends from './sentiment/zhihu/trends'
import hackernews from './sentiment/hackernews/stories'
import cryptocompare from './sentiment/cryptocompare/social'

// Dev ecosystem
import pypiStats from './dev/pypi/stats'
import npmStats from './dev/npm/stats'

// Governance
import snapshot from './governance/snapshot/proposals'

// AI Signals (derived)
import nexusSmartMoney from './ai-signals/nexus-internal'

// News
import rssEngine from './news/rss'
import redditCrypto from './news/reddit'
import cryptopanicRe from './news/cryptopanic'
import benzingaRe from './news/benzinga'
import gdelt from './news/gdelt'
import vimeroFeed from './news/vimero'
import defillamaResearch from './news/defillama'

/** Register all 58 built-in modules. Idempotent — safe to call multiple times. */
let modulesRegistered = false

export function registerAllModules() {
  const registry = getRegistry()

  // Skip re-registration if modules are already loaded
  if (modulesRegistered && registry.getAll().length > 0) {
    return registry
  }

  registry.registerAll([
    // On-chain (13)
    geckoterminal, defillama, dexscreener, hyperliquid, polymarket,
    blockscoutEth, arkhamRe, birdeyeRe, mempoolSpace, l2beat, blockchair, covalent,
    cycleIndicators,
    // Market (9)
    coingecko, binance, bybit, coinpaprika, coincap, indodax, sectorsApp, eastmoney, marketFlow,
    fred, fearGreed, frankfurter, exchangeRate, ecbSdw, worldbank,
    finnhubRe, secEdgar, dbnomics, usTreasury, usgsEarthquakes, gdacsAlerts,
    openMeteo, nasaEonet, reliefweb, adsbFlight, openfema, bankOfCanada,
    ukOns, imfSdmx, indonesiaMacro, bisSdmx, eurostat,
    // Derivatives (3)
    derivativesAggregate, deribitOptions, binanceFutures,
    manifold, polymarketGamma,
    // Equities RE (4)
    yahooFinance, alphaVantageRe, fmpRe, secEdgarInsider,
    // Commodities RE (1)
    metalsRe,
    // Sentiment (8)
    longshortDerived, lunarcrushRe, santimentRe, githubApi,
    googleTrends, weiboHot, zhihuTrends, hackernews, cryptocompare,
    // Dev ecosystem (2)
    pypiStats, npmStats,
    // Governance (1)
    snapshot,
    // AI Signals (1)
    nexusSmartMoney,
    // News (7)
    rssEngine, redditCrypto, cryptopanicRe, benzingaRe, gdelt, vimeroFeed,
    defillamaResearch,
  ])

  modulesRegistered = true
  return registry
}

export { getRegistry, ModuleRegistry } from './registry'
export type { DataModule, DataCategory, SourceType, ModuleResult, FetchParams } from './types'
