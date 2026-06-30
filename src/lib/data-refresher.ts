// ─────────────────────────────────────────────────────────────
// Background Data Refresher
// Pre-fetches all module data on a schedule so API routes return instantly
// Runs via setInterval in instrumentation.ts on server startup
// ─────────────────────────────────────────────────────────────

import { fetchDerivativesSnapshot, fetchRecentLiquidations, persistDerivativesSnapshot, persistLiquidations } from '@/lib/modules/derived/derivatives-intel'
import { fetchETFSummary, persistETFFlows } from '@/lib/modules/tradfi/etf-flow'
import { fetchPremiumSnapshots, persistPremiumSnapshots } from '@/lib/modules/tradfi/premium-monitor'
import { fetchSentimentIntelligence, persistSentimentSnapshots } from '@/lib/modules/sentiment/sentiment-intel'
import { fetchNewsIntelligence, persistNewsEvents } from '@/lib/modules/news/news-intel'
import { fetchCreditRisk, persistCreditRisk } from '@/lib/modules/defi/credit-risk'
import { fetchMinerFlow, persistMinerFlow } from '@/lib/modules/chain/miner-flow'
import { fetchNarrativeRotation, persistSectorFlows } from '@/lib/modules/derived/narrative-rotation'
import { fetchStakingQueue, persistStakingFlow } from '@/lib/modules/chain/staking-queue'
import { fetchMempoolEvents } from '@/lib/modules/chain/mempool-intel'
import { fetchBridgeStats } from '@/lib/modules/chain/bridge-flow'
import { evaluateCompositeSignals } from '@/lib/modules/derived/composite-signals'
import { computeIntelligenceScore } from '@/lib/modules/derived/intelligence-score'

// ─── Shared Cache ───────────────────────────────────────────

interface CacheEntry<T> {
  data: T
  ts: number
}

class SharedCache {
  private store = new Map<string, CacheEntry<unknown>>()

  get<T>(key: string): T | null {
    const entry = this.store.get(key)
    return entry ? (entry.data as T) : null
  }

  set<T>(key: string, data: T): void {
    this.store.set(key, { data, ts: Date.now() })
  }

  age(key: string): number {
    const entry = this.store.get(key)
    return entry ? Date.now() - entry.ts : Infinity
  }
}

export const sharedCache = new SharedCache()

// ─── Refresh Functions ──────────────────────────────────────

async function refreshDerivatives() {
  try {
    const snapshots = await fetchDerivativesSnapshot()
    sharedCache.set('derivatives:snapshots', snapshots)
    persistDerivativesSnapshot(snapshots).catch(() => {})

    const liquidations = await fetchRecentLiquidations()
    sharedCache.set('derivatives:liquidations', liquidations)
    persistLiquidations(liquidations).catch(() => {})

    sharedCache.set('derivatives:combined', { snapshots, liquidations })
    console.log(`[refresher] derivatives: ${snapshots.length} snapshots, ${liquidations.length} liquidations`)
  } catch (e) { console.error('[refresher] derivatives failed:', (e as Error).message) }
}

async function refreshETF() {
  try {
    const etf = await fetchETFSummary()
    sharedCache.set('etf:summary', etf)
    persistETFFlows(etf.flows).catch(() => {})

    const premiums = await fetchPremiumSnapshots()
    sharedCache.set('etf:premiums', premiums)
    persistPremiumSnapshots(premiums).catch(() => {})

    sharedCache.set('etf:combined', { etf, premiums })
    console.log(`[refresher] etf: ${etf.flows.length} flows, ${premiums.length} premiums`)
  } catch (e) { console.error('[refresher] etf failed:', (e as Error).message) }
}

async function refreshSentiment() {
  try {
    const sentiment = await fetchSentimentIntelligence()
    sharedCache.set('sentiment:data', sentiment)
    persistSentimentSnapshots(sentiment).catch(() => {})
    console.log(`[refresher] sentiment: ${sentiment.length} items`)
  } catch (e) { console.error('[refresher] sentiment failed:', (e as Error).message) }
}

async function refreshNews() {
  try {
    const news = await fetchNewsIntelligence()
    sharedCache.set('news:data', news)
    if (news.events?.length) persistNewsEvents(news.events).catch(() => {})
    console.log(`[refresher] news: ${news.events?.length ?? 0} events`)
  } catch (e) { console.error('[refresher] news failed:', (e as Error).message) }
}

async function refreshRisk() {
  try {
    const credit = await fetchCreditRisk()
    sharedCache.set('risk:credit', credit)
    persistCreditRisk(credit).catch(() => {})

    const miner = await fetchMinerFlow()
    sharedCache.set('risk:miner', miner)
    persistMinerFlow(miner).catch(() => {})

    const narrative = await fetchNarrativeRotation()
    sharedCache.set('risk:narrative', narrative)
    persistSectorFlows(narrative).catch(() => {})

    sharedCache.set('risk:combined', { creditRisk: credit, minerFlow: miner, narrative })
    console.log(`[refresher] risk: ${credit.length} credit, miner hr=${miner.hashRate}, ${narrative.length} sectors`)
  } catch (e) { console.error('[refresher] risk failed:', (e as Error).message) }
}

async function refreshOnchain() {
  try {
    const mempool = await fetchMempoolEvents()
    sharedCache.set('onchain:mempool', mempool)

    const bridge = await fetchBridgeStats()
    sharedCache.set('onchain:bridge', bridge)

    const staking = await fetchStakingQueue()
    sharedCache.set('onchain:staking', staking)
    persistStakingFlow(staking).catch(() => {})

    sharedCache.set('onchain:combined', { mempool, bridge, staking })
    console.log(`[refresher] onchain: ${mempool.length} mempool, ${bridge.bridges.length} bridges, staking entry=${staking.entryQueue}`)
  } catch (e) { console.error('[refresher] onchain failed:', (e as Error).message) }
}

async function refreshComposite() {
  try {
    const signals = await evaluateCompositeSignals()
    sharedCache.set('composite:signals', signals)
    console.log(`[refresher] composite: ${signals.length} signals`)
  } catch (e) { console.error('[refresher] composite failed:', (e as Error).message) }
}

async function refreshScore() {
  try {
    const score = await computeIntelligenceScore()
    sharedCache.set('score:data', score)
    console.log(`[refresher] score: ${score.composite}/100 (${score.direction}), ${score.confidence}% confidence`)
  } catch (e) { console.error('[refresher] score failed:', (e as Error).message) }
}

// ─── Orchestrator ───────────────────────────────────────────

const FAST_INTERVAL = 60 * 1000      // 1 min for time-sensitive data
const MEDIUM_INTERVAL = 5 * 60 * 1000 // 5 min for moderately fresh data
const SLOW_INTERVAL = 15 * 60 * 1000  // 15 min for slow-changing data

let initialized = false

export function startDataRefresher() {
  if (initialized) return
  initialized = true

  console.log('[refresher] Starting background data refresher...')

  // Run immediately on startup (stagger to avoid thundering herd)
  setTimeout(() => refreshDerivatives(), 1_000)
  setTimeout(() => refreshETF(), 3_000)
  setTimeout(() => refreshSentiment(), 5_000)
  setTimeout(() => refreshNews(), 7_000)
  setTimeout(() => refreshRisk(), 9_000)
  setTimeout(() => refreshOnchain(), 11_000)
  setTimeout(() => refreshComposite(), 15_000)
  setTimeout(() => refreshScore(), 20_000)

  // Recurring intervals
  setInterval(refreshDerivatives, FAST_INTERVAL)      // 1 min — funding/OI is time-sensitive
  setInterval(refreshETF, MEDIUM_INTERVAL)             // 5 min
  setInterval(refreshSentiment, MEDIUM_INTERVAL)       // 5 min
  setInterval(refreshNews, SLOW_INTERVAL)              // 15 min — news doesn't change fast
  setInterval(refreshRisk, MEDIUM_INTERVAL)            // 5 min
  setInterval(refreshOnchain, FAST_INTERVAL)           // 1 min — mempool is time-sensitive
  setInterval(refreshComposite, MEDIUM_INTERVAL)       // 5 min
  setInterval(refreshScore, MEDIUM_INTERVAL)           // 5 min

  console.log('[refresher] Scheduled: derivatives(1m), etf(5m), sentiment(5m), news(15m), risk(5m), onchain(1m), composite(5m), score(5m)')
}
