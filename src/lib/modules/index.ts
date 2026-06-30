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
import sectorsApp from './market/sectors-app'
import eastmoney from './market/eastmoney'
import marketFlow from './market/market-flow'

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
import usgsEarthquakes from './macro/usgs-earthquakes'
import gdacsAlerts from './macro/gdacs-alerts'
import openMeteo from './macro/open-meteo'
import nasaEonet from './macro/nasa-eonet'
import reliefweb from './macro/reliefweb'
import adsbFlight from './macro/adbs'
import openfema from './macro/openfema'
import bankOfCanada from './macro/bank-of-canada'
import ukOns from './macro/uk-ons'
import imfSdmx from './macro/imf-sdmx'
import indonesiaMacro from './macro/indonesia'
import bisSdmx from './macro/bis-sdmx'
import eurostat from './macro/eurostat'

// Derivatives
import derivativesAggregate from './derivatives/aggregate'
import deribitOptions from './derivatives/deribit-options'
import binanceFutures from './derivatives/binance-futures'

// Prediction
import manifold from './prediction/manifold'
import polymarketGamma from './prediction/polymarket'

// Equities (RE)
import yahooFinance from './equities/yahoo-finance'
import alphaVantageRe from './equities/alpha-vantage-re'
import fmpRe from './equities/fmp-re'
import secEdgarInsider from './equities/sec-edgar'

// Commodities (RE)
import metalsRe from './commodities/metals-re'

// Sentiment
import longshortDerived from './sentiment/longshort-derived'
import lunarcrushRe from './sentiment/lunarcrush-re'
import santimentRe from './sentiment/santiment-re'
import githubApi from './sentiment/github'
import googleTrends from './sentiment/google-trends'
import weiboHot from './sentiment/weibo-hot'
import zhihuTrends from './sentiment/zhihu-trends'
import hackernews from './sentiment/hackernews'

// Dev ecosystem
import pypiStats from './dev/pypi-stats'
import npmStats from './dev/npm-stats'

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
import vimeroFeed from './news/vimero-feed'
import defillamaResearch from './news/defillama-research'

/** Register all 58 built-in modules. Idempotent — safe to call multiple times. */
let modulesRegistered = false

export function registerAllModules() {
  const registry = getRegistry()

  // Skip re-registration if modules are already loaded
  if (modulesRegistered && registry.getAll().length > 0) {
    return registry
  }

  registry.registerAll([
    // On-chain (12)
    geckoterminal, defillama, dexscreener, hyperliquid, polymarket,
    blockscoutEth, arkhamRe, birdeyeRe, mempoolSpace, l2beat, blockchair, covalent,
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
    googleTrends, weiboHot, zhihuTrends, hackernews,
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
