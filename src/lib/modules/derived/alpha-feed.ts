// ─────────────────────────────────────────────────────────────
// Alpha Signal Feed — Unified ranked signal stream
// Merges smart money, whale detection, insider, exchange flow,
// gaps, news, weather, derivatives into one feed
// ─────────────────────────────────────────────────────────────

export interface AlphaSignal {
  id: string
  type: 'smart_money' | 'whale' | 'insider' | 'exchange_flow' | 'gap' | 'news' | 'weather' | 'liquidation' | 'new_listing' | 'correlation' | 'derivatives'
  asset: string
  direction: 'bullish' | 'bearish' | 'neutral'
  strength: number
  confidence: number
  headline: string
  explanation: string
  source: string
  timestamp: Date
  route?: string
}

let cachedSignals: AlphaSignal[] = []
let lastUpdate = 0
const CACHE_TTL = 30_000

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4400'

async function api<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(12_000) })
    if (!res.ok) return null
    const json = await res.json() as { data?: T }
    return json.data ?? null
  } catch { return null }
}

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

export async function fetchAlphaSignals(limit = 50): Promise<AlphaSignal[]> {
  const now = Date.now()
  if (cachedSignals.length > 0 && now - lastUpdate < CACHE_TTL) {
    return cachedSignals.slice(0, limit)
  }

  const signals: AlphaSignal[] = []

  // Fetch all data sources in parallel
  const [
    whaleData,
    insiderData,
    exchangeFlowData,
    edgeReport,
    fgData,
    newsData,
    liquidationData,
    derivativesData,
    smartMoneyData,
    weatherData,
  ] = await Promise.allSettled([
    api<Record<string, unknown>>('/api/v1/mempool?action=whale'),
    api<Array<Record<string, unknown>>>('/api/v1/insider'),
    api<Record<string, unknown>>('/api/v1/exchange-flow'),
    api<Record<string, unknown>>('/api/v1/edge-report'),
    api<Record<string, unknown>>('/api/v1/fear-greed'),
    api<Record<string, unknown>>('/api/v1/news'),
    api<Record<string, unknown>>('/api/v1/liquidations?symbol=BTC'),
    api<Record<string, unknown>>('/api/v1/derivatives?limit=10'),
    api<Record<string, unknown>>('/api/v1/smart-money?pageSize=10'),
    api<Record<string, unknown>>('/api/v1/weather-signals?action=anomalies'),
  ])

  // ── Whale Signals ──
  if (whaleData.status === 'fulfilled' && whaleData.value) {
    const txs = (whaleData.value.transactions as Array<Record<string, unknown>>) || []
    for (const tx of txs.slice(0, 5)) {
      const btc = (tx.valueBtc as number) || 0
      const usd = (tx.valueUsd as number) || 0
      if (btc >= 10) {
        signals.push({
          id: `whale-${String(tx.txid).slice(0, 8)}-${now}`,
          type: 'whale',
          asset: 'BTC',
          direction: 'neutral',
          strength: Math.min(100, Math.round(btc * 2)),
          confidence: 0.9,
          headline: `🐋 Whale Alert: ${btc.toFixed(2)} BTC (${fmtUsd(usd)}) moved`,
          explanation: `Large Bitcoin transaction detected in recent block. TX: ${String(tx.txid).slice(0, 16)}...`,
          source: 'Mempool.space',
          timestamp: new Date(),
          route: '/mempool',
        })
      }
    }
  }

  // ── Insider Signals ──
  if (insiderData.status === 'fulfilled' && Array.isArray(insiderData.value)) {
    for (const s of insiderData.value.slice(0, 5)) {
      const amt = (s.largeTxAmount as number) || 0
      const risk = (s.riskScore as number) || 0
      if (risk >= 30) {
        signals.push({
          id: `insider-${String(s.id).slice(0, 12)}-${now}`,
          type: 'insider',
          asset: String(s.largeTxToken || 'Unknown'),
          direction: 'neutral',
          strength: risk,
          confidence: risk / 100,
          headline: `🔍 Insider Signal: ${fmtUsd(amt)} from fresh wallet (risk: ${risk})`,
          explanation: `Fresh wallet ${String(s.walletAddress).slice(0, 10)}... moved ${fmtUsd(amt)}. ${Array.isArray(s.suspicionReasons) ? s.suspicionReasons.join(', ') : ''}`,
          source: 'Insider Detector',
          timestamp: new Date(),
          route: '/insider',
        })
      }
    }
  }

  // ── Exchange Flow Signals ──
  if (exchangeFlowData.status === 'fulfilled' && exchangeFlowData.value) {
    const d = exchangeFlowData.value
    const net = (d.totalNetFlow as number) || 0
    const signal = String(d.signal || 'neutral')
    if (Math.abs(net) > 100_000_000) {
      signals.push({
        id: `exflow-${now}`,
        type: 'exchange_flow',
        asset: 'BTC/ETH',
        direction: net > 0 ? 'bearish' : 'bullish',
        strength: Math.min(100, Math.round(Math.abs(net) / 10_000_000)),
        confidence: 0.8,
        headline: `💰 Exchange Flow: ${net > 0 ? 'Net Inflow' : 'Net Outflow'} ${fmtUsd(Math.abs(net))} — ${signal}`,
        explanation: `${net > 0 ? 'More deposits than withdrawals — potential selling pressure' : 'More withdrawals than deposits — accumulation signal'}`,
        source: 'Exchange Flow',
        timestamp: new Date(),
        route: '/exchange-flow',
      })
    }

    // Whale events from exchange flow
    const whaleEvents = (d.whaleEvents as Array<Record<string, unknown>>) || []
    for (const ev of whaleEvents.slice(0, 3)) {
      const val = (ev.estimatedValue as number) || 0
      if (val > 50_000_000) {
        signals.push({
          id: `exwhale-${String(ev.id).slice(0, 12)}-${now}`,
          type: 'whale',
          asset: String(ev.symbol || '?'),
          direction: ev.direction === 'deposit' ? 'bearish' : 'bullish',
          strength: Math.min(100, Math.round(val / 10_000_000)),
          confidence: ev.confidence as number || 0.7,
          headline: `🐋 ${String(ev.exchange).toUpperCase()} ${ev.direction}: ${fmtUsd(val)} ${ev.symbol}`,
          explanation: `Large ${ev.direction} detected on ${ev.exchange}. Price change: ${(ev.priceChange as number || 0).toFixed(2)}%`,
          source: 'Exchange Flow',
          timestamp: new Date(),
          route: '/exchange-flow',
        })
      }
    }
  }

  // ── Fear & Greed ──
  if (fgData.status === 'fulfilled' && fgData.value) {
    const composite = fgData.value.composite as Record<string, unknown> | undefined
    const score = (composite?.score as number) ?? 50
    const regime = fgData.value.regime as Record<string, unknown> | undefined
    if (score < 25 || score > 75) {
      signals.push({
        id: `fg-${now}`,
        type: 'smart_money',
        asset: 'Market',
        direction: score < 25 ? 'bullish' : 'bearish',
        strength: Math.abs(score - 50) * 2,
        confidence: 0.7,
        headline: `${score < 25 ? '🟢' : '🔴'} Fear & Greed: ${score}/100 — ${score < 25 ? 'Extreme Fear (buy signal)' : 'Extreme Greed (caution)'}`,
        explanation: `Regime: ${regime?.state || 'Unknown'} · Stance: ${regime?.stance || 'Unknown'}`,
        source: 'Fear & Greed Index',
        timestamp: new Date(),
        route: '/fear-greed',
      })
    }
  }

  // ── News ──
  if (newsData.status === 'fulfilled' && newsData.value) {
    const items = (newsData.value.items as Array<Record<string, unknown>>) || []
    for (const item of items.slice(0, 5)) {
      signals.push({
        id: `news-${String(item.id || item.title).slice(0, 20)}-${now}`,
        type: 'news',
        asset: 'Crypto',
        direction: 'neutral',
        strength: 35,
        confidence: 0.5,
        headline: `📰 ${String(item.title || 'News update').slice(0, 80)}`,
        explanation: String(item.summary || item.description || '').slice(0, 150),
        source: String(item.sourceId || 'RSS'),
        timestamp: new Date(String(item.publishedAt || Date.now())),
        route: '/news',
      })
    }
  }

  // ── Edge Report ──
  if (edgeReport.status === 'fulfilled' && edgeReport.value) {
    const er = edgeReport.value
    const erSignals = (er.signals as Array<Record<string, unknown>>) || []
    for (const s of erSignals.slice(0, 5)) {
      signals.push({
        id: `edge-${String(s.asset)}-${now}`,
        type: 'smart_money',
        asset: String(s.asset || 'Market'),
        direction: (s.direction as 'bullish' | 'bearish' | 'neutral') || 'neutral',
        strength: Math.round((s.confidence as number || 0.5) * 100),
        confidence: (s.confidence as number) || 0.5,
        headline: `📊 ${s.signalType}: ${s.asset}`,
        explanation: String(s.explanation || ''),
        source: 'Edge Report',
        timestamp: new Date(),
        route: '/smart-money',
      })
    }
  }

  // ── Liquidation Signals ──
  if (liquidationData.status === 'fulfilled' && liquidationData.value) {
    const spotlight = liquidationData.value.spotlight as Record<string, unknown> | undefined
    if (spotlight) {
      const funding = (spotlight.fundingRate as number) || 0
      if (Math.abs(funding) > 0.01) {
        signals.push({
          id: `liq-${now}`,
          type: 'liquidation',
          asset: 'BTC',
          direction: funding > 0 ? 'bearish' : 'bullish',
          strength: Math.min(100, Math.round(Math.abs(funding) * 1000)),
          confidence: 0.6,
          headline: `💦 Funding Rate: ${(funding * 100).toFixed(4)}% — ${funding > 0 ? 'Longs paying shorts' : 'Shorts paying longs'}`,
          explanation: `Extreme funding rate detected. Price: ${fmtUsd((spotlight.price as number) || 0)}`,
          source: 'Hyperliquid',
          timestamp: new Date(),
          route: '/liquidations',
        })
      }
    }
  }

  // ── Derivatives Signals ──
  if (derivativesData.status === 'fulfilled' && derivativesData.value) {
    const pairs = (derivativesData.value.topPairs as Array<Record<string, unknown>>) || []
    for (const p of pairs.slice(0, 3)) {
      const fr = (p.fundingRate as number) || 0
      const vol = (p.volume24h as number) || 0
      if (Math.abs(fr) > 0.005 && vol > 100_000_000) {
        signals.push({
          id: `deriv-${String(p.symbol)}-${now}`,
          type: 'derivatives',
          asset: String(p.symbol || '?'),
          direction: fr > 0 ? 'bearish' : 'bullish',
          strength: Math.min(100, Math.round(Math.abs(fr) * 2000)),
          confidence: 0.65,
          headline: `📈 ${p.symbol} Funding: ${(fr * 100).toFixed(4)}% — Vol: ${fmtUsd(vol)}`,
          explanation: `${fr > 0 ? 'Longs crowded' : 'Shorts crowded'}. High volume = high conviction.`,
          source: 'Binance Futures',
          timestamp: new Date(),
          route: '/derivatives',
        })
      }
    }
  }

  // ── Smart Money Signals ──
  if (smartMoneyData.status === 'fulfilled' && smartMoneyData.value) {
    const wallets = (smartMoneyData.value.wallets as Array<Record<string, unknown>>) || []
    for (const w of wallets.slice(0, 3)) {
      const pnl = (w.pnl7d as number) || (w.totalPnl as number) || 0
      if (Math.abs(pnl) > 20) {
        signals.push({
          id: `smart-${String(w.address).slice(0, 10)}-${now}`,
          type: 'smart_money',
          asset: 'Portfolio',
          direction: pnl > 0 ? 'bullish' : 'bearish',
          strength: Math.min(100, Math.round(Math.abs(pnl))),
          confidence: 0.7,
          headline: `🧠 Smart Money: ${String(w.address).slice(0, 10)}... PnL ${pnl > 0 ? '+' : ''}${pnl.toFixed(1)}%`,
          explanation: `Win rate: ${(w.winRate as number || 0).toFixed(0)}% · Trades: ${w.tradeCount || '?'}`,
          source: 'Smart Money Tracker',
          timestamp: new Date(),
          route: '/smart-money',
        })
      }
    }
  }

  // ── Weather Signals ──
  if (weatherData.status === 'fulfilled' && weatherData.value) {
    const results = (weatherData.value.results as Array<Record<string, unknown>>) || []
    for (const r of results.slice(0, 3)) {
      const anomalies = (r.anomalies as Array<Record<string, unknown>>) || []
      const maxZ = Math.max(...anomalies.map(a => Math.abs((a.zScore as number) || 0)), 0)
      if (maxZ >= 2) {
        const commodities = (r.affectedCommodities as Array<{ commodity?: string }>) || []
        signals.push({
          id: `weather-${String(r.region)}-${now}`,
          type: 'weather',
          asset: commodities.map(c => c.commodity).join(', ') || 'Commodities',
          direction: 'neutral',
          strength: Math.min(100, Math.round(maxZ * 25)),
          confidence: 0.6,
          headline: `🌤 Weather Alert: ${r.region} — z-score ${maxZ.toFixed(1)}σ`,
          explanation: `Anomalous weather in ${r.region}. Affects: ${commodities.map(c => c.commodity).join(', ')}`,
          source: 'Open-Meteo',
          timestamp: new Date(),
          route: '/weather',
        })
      }
    }
  }

  // Sort by strength descending
  signals.sort((a, b) => b.strength - a.strength)

  cachedSignals = signals
  lastUpdate = now
  return signals.slice(0, limit)
}
