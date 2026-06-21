// ─────────────────────────────────────────────────────────────
// Alpha Signal Feed — Unified ranked signal stream
// §Phase 6 — merges smart money, gaps, news, weather into one feed
// This is the single highest-value screen: no competitor can produce this
// because they all silo TradFi, on-chain, news, and weather separately.
// ─────────────────────────────────────────────────────────────

export interface AlphaSignal {
  id: string
  type: 'smart_money' | 'gap' | 'news' | 'weather' | 'liquidation' | 'new_listing' | 'correlation'
  asset: string
  direction: 'bullish' | 'bearish' | 'neutral'
  strength: number // 0-100
  confidence: number // 0-1
  headline: string
  explanation: string
  source: string
  sourceCountry?: string
  localOnlyScore?: number
  zScore?: number
  timestamp: Date
  route?: string // deep-link to relevant panel
}

interface FeedSource {
  id: string
  fetch: () => Promise<AlphaSignal[]>
  interval: number
  lastFetch: number
}

const sources: FeedSource[] = []
let cachedSignals: AlphaSignal[] = []
let lastUpdate = 0

export function registerFeedSource(source: FeedSource): void {
  sources.push(source)
}

/**
 * Fetch all signals from all registered sources, merge and rank by strength.
 */
export async function fetchAlphaSignals(limit = 50): Promise<AlphaSignal[]> {
  const now = Date.now()
  if (cachedSignals.length > 0 && now - lastUpdate < 15_000) {
    return cachedSignals.slice(0, limit)
  }

  const allSignals: AlphaSignal[] = []

  for (const source of sources) {
    if (now - source.lastFetch < source.interval) {
      continue
    }
    try {
      const signals = await source.fetch()
      allSignals.push(...signals)
      source.lastFetch = now
    } catch {
      // Source failed — skip, don't crash feed
    }
  }

  // Also fetch from existing APIs
  try {
    const [edgeRes, fgRes, newsRes] = await Promise.allSettled([
      import('@/lib/modules/derived/edge-report').then(m => m.generateEdgeReport()),
      import('@/lib/modules').then(m => { const reg = m.registerAllModules(); return reg.fetchOne('fear-greed') }),
      import('@/lib/modules').then(m => { const reg = m.registerAllModules(); return reg.fetchOne('rss-engine', { limit: '10' }) }),
    ])

    if (edgeRes.status === 'fulfilled' && edgeRes.value?.signals) {
      for (const s of edgeRes.value.signals) {
        allSignals.push({
          id: `edge-${s.asset}-${Date.now()}`,
          type: 'smart_money',
          asset: s.asset || 'Market',
          direction: s.direction || 'neutral',
          strength: Math.round((s.confidence || 0.5) * 100),
          confidence: s.confidence || 0.5,
          headline: `${s.signalType}: ${s.asset}`,
          explanation: s.explanation || '',
          source: 'Edge Report',
          timestamp: new Date(),
          route: '/smart-money',
        })
      }
    }

    if (fgRes.status === 'fulfilled' && fgRes.value) {
      const score = (fgRes.value.data as any).score
      if (score < 25 || score > 75) {
        allSignals.push({
          id: `fg-${Date.now()}`,
          type: 'smart_money',
          asset: 'Market Sentiment',
          direction: score < 25 ? 'bullish' : 'bearish',
          strength: Math.abs(score - 50),
          confidence: 0.7,
          headline: `Fear & Greed: ${score} (${score < 25 ? 'Extreme Fear — buy signal' : 'Extreme Greed — caution'})`,
          explanation: (fgRes.value.data as any).label || '',
          source: 'Fear & Greed Index',
          timestamp: new Date(),
          route: '/fear-greed',
        })
      }
    }

    if (newsRes.status === 'fulfilled' && newsRes.value?.data && (newsRes.value.data as any).items) {
      for (const item of ((newsRes.value.data as any).items || []).slice(0, 3)) {
        allSignals.push({
          id: `news-${item.id}`,
          type: 'news',
          asset: 'Crypto',
          direction: 'neutral',
          strength: 40,
          confidence: 0.5,
          headline: item.title || 'News update',
          explanation: item.summary || '',
          source: item.sourceId || 'RSS',
          sourceCountry: 'global',
          timestamp: new Date(item.publishedAt),
          route: '/news',
        })
      }
    }

    // Insider signals — fresh wallets with large txs
    try {
      const insiderRes = await import('@/lib/modules').then(m => { const reg = m.registerAllModules(); return reg.fetchOne('insider-detector') })
      if (insiderRes.data) {
        for (const s of (insiderRes.data as any[]).slice(0, 5)) {
          allSignals.push({
            id: `insider-${s.id}`,
            type: 'smart_money' as const,
            asset: s.largeTxToken || 'Unknown',
            direction: 'bearish' as const, // Insider selling is bearish signal
            strength: s.riskScore,
            confidence: s.riskScore / 100,
            headline: `🔍 INSIDER: Fresh wallet moved $${(s.largeTxAmount / 1000).toFixed(0)}K (${s.totalTxs} prior txs, age: ${s.walletAge})`,
            explanation: s.suspicionReasons?.join('. ') || 'Fresh wallet with large transaction',
            source: 'Insider Detector',
            timestamp: new Date(s.detectedAt),
            route: '/insider',
          })
        }
      }
    } catch {
      // Insider API not available
    }
  } catch {
    // API calls failed — use whatever we have
  }

  // Rank by strength × confidence, descending
  allSignals.sort((a, b) => (b.strength * b.confidence) - (a.strength * a.confidence))

  cachedSignals = allSignals
  lastUpdate = now
  return allSignals.slice(0, limit)
}

export function getCachedSignals(): AlphaSignal[] {
  return cachedSignals
}
