// ─────────────────────────────────────────────────────────────
// Background Data Refresher
// Pre-fetches all module data on a schedule so API routes return instantly
// Cache layer lives in ./cache.ts (edge-safe, no Prisma dep)
// Runs via setInterval in instrumentation.ts on server startup
// ─────────────────────────────────────────────────────────────

import { logger } from '@/lib/logger'
import { fetchDerivativesSnapshot, fetchRecentLiquidations, persistDerivativesSnapshot, persistLiquidations } from '@/lib/modules/derived/derivatives-intel'
import { fetchMarketTicks, persistMarketTicks } from '@/lib/modules/derived/market-ticks'
import { refreshSmartMoneyScores } from '@/lib/modules/derived/sfc-engine'
import { ingestLaunchTokens } from '@/lib/modules/derived/launch-alpha-engine'
import { rankAndPersist } from '@/lib/modules/derived/opportunity-ranker'
import { refreshWalletRelationships } from '@/lib/modules/derived/wallet-graph'
import { fetchETFSummary, persistETFFlows } from '@/lib/modules/tradfi/etf/flows'
import { fetchPremiumSnapshots, persistPremiumSnapshots } from '@/lib/modules/tradfi/premium/monitor'
import { fetchSentimentIntelligence, persistSentimentSnapshots } from '@/lib/modules/sentiment/sentiment-intel'
import { fetchNewsIntelligence, persistNewsEvents } from '@/lib/modules/news/news-intel'
import { fetchCreditRisk, persistCreditRisk } from '@/lib/modules/defi/credit/risk'
import { fetchMinerFlow, persistMinerFlow } from '@/lib/modules/chain/bitcoin/miner-flow'
import { fetchNarrativeRotation, persistSectorFlows } from '@/lib/modules/derived/narrative-rotation'
import { fetchStakingQueue, persistStakingFlow } from '@/lib/modules/chain/ethereum/staking-queue'
import { fetchMempoolEvents } from '@/lib/modules/chain/mempool/intel'
import { fetchBridgeStats } from '@/lib/modules/chain/bridge/flows'
import { evaluateCompositeSignals } from '@/lib/modules/derived/composite-signals'
import { computeIntelligenceScore } from '@/lib/modules/derived/intelligence-score'
import { storeSignal, checkExpiredSignals } from '@/lib/modules/derived/backtest-engine'
import { getAlphaSignals } from '@/lib/modules/derived/alpha-engine'
// Cache layer in ./cache.ts (edge-safe, no Prisma dep)
import { cacheGet, cacheSet } from '@/lib/cache'
export { cacheGet, cacheSet }
// ─── Refresh Functions ──────────────────────────────────────

async function refreshDerivatives() {
  try {
    const snapshots = await fetchDerivativesSnapshot()
    await cacheSet('derivatives:snapshots', snapshots, 120)
    persistDerivativesSnapshot(snapshots).catch(() => {})

    const liquidations = await fetchRecentLiquidations()
    await cacheSet('derivatives:liquidations', liquidations, 120)
    persistLiquidations(liquidations).catch(() => {})

    logger.info(`derivatives: ${snapshots.length} snapshots, ${liquidations.length} liquidations`, "refresher")
  } catch (e) { logger.error("derivatives failed:", "refresher", { error: (e as Error).message }) }
}

async function refreshMarketTicks() {
  try {
    const ticks = await fetchMarketTicks()
    await cacheSet('market:ticks', ticks, 120)
    persistMarketTicks(ticks).catch(() => {})
    logger.info(`market-ticks: ${ticks.length} ticks`, 'refresher')
  } catch (e) { logger.error('market-ticks failed:', 'refresher', { error: (e as Error).message }) }
}

async function refreshSmartMoney() {
  try {
    const n = await refreshSmartMoneyScores()
    logger.info(`smart-money: ${n} wallets scored`, 'refresher')
  } catch (e) { logger.error('smart-money failed:', 'refresher', { error: (e as Error).message }) }
}

async function refreshLaunchAlpha() {
  try {
    const n = await ingestLaunchTokens()
    logger.info(`launch-alpha: ${n} tokens ingested`, 'refresher')
  } catch (e) { logger.error('launch-alpha failed:', 'refresher', { error: (e as Error).message }) }
}

async function refreshOpportunities() {
  try {
    const top = await rankAndPersist()
    logger.info(`opportunities: ${top.length} ranked`, 'refresher')
  } catch (e) { logger.error('opportunities failed:', 'refresher', { error: (e as Error).message }) }
}

async function refreshWalletGraph() {
  try {
    const n = await refreshWalletRelationships()
    logger.info(`wallet-graph: ${n} relationships derived`, 'refresher')
  } catch (e) { logger.error('wallet-graph failed:', 'refresher', { error: (e as Error).message }) }
}

async function refreshETF() {
  try {
    const etf = await fetchETFSummary()
    await cacheSet('etf:summary', etf, 600)
    persistETFFlows(etf.flows).catch(() => {})

    const premiums = await fetchPremiumSnapshots()
    await cacheSet('etf:premiums', premiums, 600)
    persistPremiumSnapshots(premiums).catch(() => {})

    logger.info(`etf: ${etf.flows.length} flows, ${premiums.length} premiums`, "refresher")
  } catch (e) { logger.error("etf failed:", "refresher", { error: (e as Error).message }) }
}

async function refreshSentiment() {
  try {
    const sentiment = await fetchSentimentIntelligence()
    await cacheSet('sentiment:data', sentiment, 600)
    persistSentimentSnapshots(sentiment).catch(() => {})
    logger.info(`sentiment: ${sentiment.length} items`, "refresher")
  } catch (e) { logger.error("sentiment failed:", "refresher", { error: (e as Error).message }) }
}

async function refreshNews() {
  try {
    const news = await fetchNewsIntelligence()
    await cacheSet('news:data', news, 900)
    if (news.events?.length) persistNewsEvents(news.events).catch(() => {})
    logger.info(`news: ${news.events?.length ?? 0} events`, "refresher")
  } catch (e) { logger.error("news failed:", "refresher", { error: (e as Error).message }) }
}

async function refreshRisk() {
  try {
    const credit = await fetchCreditRisk()
    await cacheSet('risk:credit', credit, 600)
    persistCreditRisk(credit).catch(() => {})

    const miner = await fetchMinerFlow()
    await cacheSet('risk:miner', miner, 600)
    persistMinerFlow(miner).catch(() => {})

    const narrative = await fetchNarrativeRotation()
    await cacheSet('risk:narrative', narrative, 600)
    persistSectorFlows(narrative).catch(() => {})

    logger.info(`risk: ${credit.length} credit, miner hr=${miner.hashRate}, ${narrative.length} sectors`, "refresher")
  } catch (e) { logger.error("risk failed:", "refresher", { error: (e as Error).message }) }
}

async function refreshOnchain() {
  try {
    const mempool = await fetchMempoolEvents()
    await cacheSet('onchain:mempool', mempool, 120)

    const bridge = await fetchBridgeStats()
    await cacheSet('onchain:bridge', bridge, 300)

    const staking = await fetchStakingQueue()
    await cacheSet('onchain:staking', staking, 300)
    persistStakingFlow(staking).catch(() => {})

    logger.info(`onchain: ${mempool.length} mempool, ${bridge.bridges.length} bridges, staking entry=${staking.entryQueue}`, "refresher")
  } catch (e) { logger.error("onchain failed:", "refresher", { error: (e as Error).message }) }
}

async function refreshComposite() {
  try {
    const signals = await evaluateCompositeSignals()
    await cacheSet('composite:signals', signals, 600)
    logger.info(`composite: ${signals.length} signals`, "refresher")
  } catch (e) { logger.error("composite failed:", "refresher", { error: (e as Error).message }) }
}

async function refreshScore() {
  try {
    const score = await computeIntelligenceScore()
    await cacheSet('score:data', score, 600)
    logger.info(`score: ${score.overall}/100 (${score.grade}), regime: ${score.regime}`, "refresher")
  } catch (e) { logger.error("score failed:", "refresher", { error: (e as Error).message }) }
}

// Store alpha signals to DB for history tracking
async function refreshSignalStore() {
  try {
    const { signals } = await getAlphaSignals()
    let stored = 0
    for (const s of signals) {
      if (!s.entry || !s.sl || s.direction === 'neutral') continue
      await storeSignal({
        id: s.id,
        symbol: s.symbol,
        direction: s.direction,
        entry: s.entry,
        tp1: s.tp1,
        tp2: s.tp2,
        tp3: s.tp3,
        sl: s.sl,
        timestamp: s.timestamp,
        source: s.sources[0] ?? 'unknown',
      })
      stored++
    }
    if (stored > 0) logger.info(`Stored ${stored} signals for history`, "refresher")
  } catch (err) {
    logger.error("Signal store error:", "refresher", { error: (err as Error).message })
  }
}

// Check expired signals and calculate PnL
async function refreshSignalOutcomes() {
  try {
    const result = await checkExpiredSignals()
    if (result.updated > 0) {
      logger.info(`Signal outcomes: ${result.checked} checked, ${result.updated} updated (${result.wins}W/${result.losses}L)`, "refresher")
    }
  } catch (err) {
    logger.error("Signal outcomes error:", "refresher", { error: (err as Error).message })
  }
}

// ─── Orchestrator ───────────────────────────────────────────

const FAST_INTERVAL = 60 * 1000      // 1 min for time-sensitive data
const MEDIUM_INTERVAL = 5 * 60 * 1000 // 5 min for moderately fresh data
const SLOW_INTERVAL = 15 * 60 * 1000  // 15 min for slow-changing data
const SIGNAL_INTERVAL = 60 * 60 * 1000 // 1 hour for signal storage
const OUTCOME_INTERVAL = 15 * 60 * 1000 // 15 min for signal outcome checking

let initialized = false

export function startDataRefresher() {
  if (initialized) return
  initialized = true

  logger.info("Starting background data refresher (Redis-backed)...", "refresher")

  // Run immediately on startup (stagger to avoid thundering herd)
  setTimeout(() => refreshDerivatives(), 1_000)
  setTimeout(() => refreshETF(), 3_000)
  setTimeout(() => refreshSentiment(), 5_000)
  setTimeout(() => refreshNews(), 7_000)
  setTimeout(() => refreshRisk(), 9_000)
  setTimeout(() => refreshOnchain(), 11_000)
  setTimeout(() => refreshComposite(), 15_000)
  setTimeout(() => refreshScore(), 20_000)
  setTimeout(() => refreshWalletGraph(), 20_000)
  setTimeout(() => refreshSignalStore(), 25_000)
  setTimeout(() => refreshSignalOutcomes(), 30_000)
  setTimeout(() => refreshMarketTicks(), 12_000)
  setTimeout(() => refreshSmartMoney(), 16_000)
  setTimeout(() => refreshLaunchAlpha(), 18_000)

  setTimeout(() => refreshOpportunities(), 25_000)
  // Recurring intervals
  setInterval(refreshDerivatives, FAST_INTERVAL)
  setInterval(refreshETF, MEDIUM_INTERVAL)
  setInterval(refreshSentiment, MEDIUM_INTERVAL)
  setInterval(refreshNews, SLOW_INTERVAL)
  setInterval(refreshRisk, MEDIUM_INTERVAL)
  setInterval(refreshOnchain, FAST_INTERVAL)
  setInterval(refreshComposite, MEDIUM_INTERVAL)
  setInterval(refreshWalletGraph, MEDIUM_INTERVAL)
  setInterval(refreshScore, MEDIUM_INTERVAL)
  setInterval(refreshSignalStore, SIGNAL_INTERVAL)      // Store signals hourly
  setInterval(refreshSignalOutcomes, OUTCOME_INTERVAL)  // Check outcomes every 15 min
  setInterval(refreshMarketTicks, MEDIUM_INTERVAL)
  setInterval(refreshSmartMoney, SIGNAL_INTERVAL)
  setInterval(refreshLaunchAlpha, MEDIUM_INTERVAL)

  setInterval(refreshOpportunities, SIGNAL_INTERVAL)
  logger.info("Scheduled: derivatives(1m), etf(5m), sentiment(5m), news(15m), risk(5m), onchain(1m), composite(5m), score(5m), signals(1h), outcomes(15m)", "refresher")
}
