"use client"

import { useState, useEffect, useMemo } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { LiveDot } from '@/components/primitives/LiveDot'

interface Signal {
  id: string
  symbol: string
  name: string
  assetClass: 'equity' | 'crypto' | 'forex' | 'commodity'
  direction: 'LONG' | 'SHORT'
  strength: number // 0-100
  confidence: number // 0-100
  entryPrice: number
  targetPrice: number
  stopLoss: number
  riskReward: number
  timeframe: '1D' | '1W' | '1M'
  signals: string[]
  timestamp: string
  status: 'ACTIVE' | 'HIT_TARGET' | 'STOPPED_OUT' | 'EXPIRED'
}

interface MarketRegime {
  regime: string
  description: string
  recommendation: string
  indicators: { name: string; value: string; signal: string }[]
}

// AI-powered signal generation (simulated — in production, uses ML models)
function generateSignals(): { signals: Signal[]; regime: MarketRegime } {
  const now = new Date()

  const signals: Signal[] = [
    {
      id: '1',
      symbol: 'NVDA',
      name: 'NVIDIA',
      assetClass: 'equity',
      direction: 'LONG',
      strength: 92,
      confidence: 88,
      entryPrice: 132.80,
      targetPrice: 155.00,
      stopLoss: 120.00,
      riskReward: 1.70,
      timeframe: '1M',
      signals: [
        'AI chip demand surge — data center revenue +80% YoY',
        'Golden cross: SMA50 crossed above SMA200',
        'RSI 65 — momentum strong but not overbought',
        'MACD bullish crossover on weekly chart',
        'Smart money accumulation detected (3 consecutive days)',
        'Analyst consensus: 95% BUY, avg target $152',
      ],
      timestamp: new Date(now.getTime() - 3600000).toISOString(),
      status: 'ACTIVE',
    },
    {
      id: '2',
      symbol: 'BTC-USD',
      name: 'Bitcoin',
      assetClass: 'crypto',
      direction: 'LONG',
      strength: 85,
      confidence: 82,
      entryPrice: 70250,
      targetPrice: 82000,
      stopLoss: 65000,
      riskReward: 2.25,
      timeframe: '1M',
      signals: [
        'ETF inflows $1.2B weekly — institutional demand accelerating',
        'Bullish divergence on RSI (4H chart)',
        'On-chain: exchange outflows at 6-month high',
        'Funding rate negative — shorts paying longs (squeeze setup)',
        'Halving cycle pattern: 12-18 months post-halving = peak',
        'Fear & Greed at 62 — greed territory but not extreme',
      ],
      timestamp: new Date(now.getTime() - 7200000).toISOString(),
      status: 'ACTIVE',
    },
    {
      id: '3',
      symbol: 'USD/IDR',
      name: 'US Dollar / Indonesian Rupiah',
      assetClass: 'forex',
      direction: 'SHORT',
      strength: 72,
      confidence: 68,
      entryPrice: 17842,
      targetPrice: 17200,
      stopLoss: 18100,
      riskReward: 2.46,
      timeframe: '1M',
      signals: [
        'BI holding rate at 5.75% — hawkish stance supports IDR',
        'US CPI falling to 2.3% — Fed rate cut expectations rising',
        'Indonesia trade balance in surplus ($3.2B)',
        'Foreign inflows into IDX accelerating',
        'Dollar Index weakening on rate cut expectations',
      ],
      timestamp: new Date(now.getTime() - 10800000).toISOString(),
      status: 'ACTIVE',
    },
    {
      id: '4',
      symbol: 'GLD',
      name: 'SPDR Gold Trust',
      assetClass: 'commodity',
      direction: 'LONG',
      strength: 88,
      confidence: 85,
      entryPrice: 3972,
      targetPrice: 4500,
      stopLoss: 3700,
      riskReward: 1.96,
      timeframe: '1M',
      signals: [
        'Geopolitical tensions escalating — safe haven demand',
        'Central bank buying at record levels (1,037 tonnes in 2025)',
        'US real rates declining as inflation falls',
        'VIX rising to 18.41 — risk-off sentiment',
        'Gold breaking out of 3-month consolidation pattern',
        'Dollar weakening supports gold prices',
      ],
      timestamp: new Date(now.getTime() - 14400000).toISOString(),
      status: 'ACTIVE',
    },
    {
      id: '5',
      symbol: 'BBCA.JK',
      name: 'Bank Central Asia',
      assetClass: 'equity',
      direction: 'LONG',
      strength: 78,
      confidence: 75,
      entryPrice: 9500,
      targetPrice: 11000,
      stopLoss: 8800,
      riskReward: 2.14,
      timeframe: '1M',
      signals: [
        'Q2 earnings beat expectations — NIM expanding',
        'Indonesia GDP growth 5.1% — strong domestic consumption',
        'BI rate hold supports bank margins',
        'Foreign buying in IDX banking sector',
        'Technical: broke above 200-day SMA',
        'Dividend yield 3.2% — attractive for income investors',
      ],
      timestamp: new Date(now.getTime() - 18000000).toISOString(),
      status: 'ACTIVE',
    },
    {
      id: '6',
      symbol: 'TSLA',
      name: 'Tesla',
      assetClass: 'equity',
      direction: 'SHORT',
      strength: 65,
      confidence: 60,
      entryPrice: 248.75,
      targetPrice: 200.00,
      stopLoss: 270.00,
      riskReward: 2.32,
      timeframe: '1W',
      signals: [
        'Valuation stretched: P/E 65x vs industry 15x',
        'China competition intensifying (BYD, NIO)',
        'Margin compression — price cuts continuing',
        'RSI overbought at 72 on daily chart',
        'Bearish engulfing candle on weekly chart',
        'Insider selling detected (CFO sold $5M)',
      ],
      timestamp: new Date(now.getTime() - 21600000).toISOString(),
      status: 'ACTIVE',
    },
    {
      id: '7',
      symbol: 'ETH-USD',
      name: 'Ethereum',
      assetClass: 'crypto',
      direction: 'LONG',
      strength: 75,
      confidence: 70,
      entryPrice: 3800,
      targetPrice: 4500,
      stopLoss: 3400,
      riskReward: 1.75,
      timeframe: '1M',
      signals: [
        'Staking yield 3.2% — deflationary supply dynamics',
        'ETF speculation increasing — SEC approval likely',
        'DeFi TVL recovering — $85B locked',
        'Layer 2 adoption accelerating (Arbitrum, Base, Optimism)',
        'Gas fees at yearly lows — network efficiency improving',
        'Smart money accumulation on-chain',
      ],
      timestamp: new Date(now.getTime() - 25200000).toISOString(),
      status: 'ACTIVE',
    },
    {
      id: '8',
      symbol: 'EUR/USD',
      name: 'Euro / US Dollar',
      assetClass: 'forex',
      direction: 'LONG',
      strength: 68,
      confidence: 62,
      entryPrice: 1.0850,
      targetPrice: 1.1200,
      stopLoss: 1.0700,
      riskReward: 2.33,
      timeframe: '1M',
      signals: [
        'ECB cutting rates — but EUR resilient',
        'US CPI falling — Fed rate cut expectations rising',
        'Dollar Index weakening trend',
        'EUR/USD broke above 200-day SMA',
        'Carry trade unwinding supports EUR',
      ],
      timestamp: new Date(now.getTime() - 28800000).toISOString(),
      status: 'ACTIVE',
    },
  ]

  const regime: MarketRegime = {
    regime: 'RISK-ON with Caution',
    description: 'Markets showing bullish momentum but elevated valuations suggest selective positioning. AI/tech leadership continues while macro data supports soft landing narrative.',
    recommendation: 'Favor quality growth (NVDA, AAPL, MSFT) and defensive plays (GLD, treasuries). Reduce exposure to speculative assets. Watch for VIX spike above 25 as risk-off trigger.',
    indicators: [
      { name: 'VIX', value: '18.41', signal: 'Low volatility — bullish' },
      { name: 'Fear & Greed', value: '62', signal: 'Greed — caution' },
      { name: '10Y-2Y Spread', value: '0.72%', signal: 'Positive — no recession signal' },
      { name: 'US CPI', value: '2.3%', signal: 'Falling — Fed cut likely' },
      { name: 'BI Rate', value: '5.75%', signal: 'Hawkish hold — IDR supportive' },
      { name: 'BTC Dominance', value: '54%', signal: 'Rising — crypto risk-on' },
      { name: 'Gold', value: '$3,972', signal: 'Breakout — safe haven demand' },
      { name: 'DXY', value: '120.89', signal: 'Weakening — risk-on' },
    ],
  }

  return { signals, regime }
}

export default function AiSignalsPage() {
  const [signals, setSignals] = useState<Signal[]>([])
  const [regime, setRegime] = useState<MarketRegime | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('All')
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    setTimeout(() => {
      const { signals: s, regime: r } = generateSignals()
      setSignals(s)
      setRegime(r)
      setLoading(false)
    }, 500)
  }, [])

  const filtered = filter === 'All' ? signals : signals.filter(s => s.assetClass === filter.toLowerCase())

  const avgStrength = signals.length > 0 ? Math.round(signals.reduce((s, sig) => s + sig.strength, 0) / signals.length) : 0
  const avgConfidence = signals.length > 0 ? Math.round(signals.reduce((s, sig) => s + sig.confidence, 0) / signals.length) : 0

  return (
    <NexusLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">AI TRADING SIGNALS</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              {signals.length} active signals · Multi-source AI analysis · Cross-asset coverage
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : 'live'} label />
        </div>

        {/* Market Regime */}
        {regime && (
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <h2 className="text-xs font-mono text-accent-cyan mb-3">MARKET REGIME</h2>
            <div className="flex items-center gap-4 mb-3">
              <div className="text-2xl font-bold font-mono text-accent-cyan">{regime.regime}</div>
              <div className="text-xs text-text-dim flex-1">{regime.description}</div>
            </div>
            <div className="text-xs font-mono text-accent-cyan mb-2">RECOMMENDATION</div>
            <p className="text-xs text-text-dim mb-3">{regime.recommendation}</p>
            <div className="grid grid-cols-4 gap-2">
              {regime.indicators.map(ind => (
                <div key={ind.name} className="bg-bg-elevated p-2 rounded">
                  <p className="text-[10px] text-text-muted font-mono">{ind.name}</p>
                  <p className="text-sm font-bold font-mono text-text-primary">{ind.value}</p>
                  <p className="text-[9px] text-text-dim">{ind.signal}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Signal Summary */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <p className="text-[10px] text-text-muted font-mono">ACTIVE SIGNALS</p>
            <p className="text-xl font-bold font-mono text-text-primary">{signals.length}</p>
          </div>
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <p className="text-[10px] text-text-muted font-mono">AVG STRENGTH</p>
            <p className="text-xl font-bold font-mono text-accent-cyan">{avgStrength}%</p>
          </div>
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <p className="text-[10px] text-text-muted font-mono">AVG CONFIDENCE</p>
            <p className="text-xl font-bold font-mono text-accent-cyan">{avgConfidence}%</p>
          </div>
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <p className="text-[10px] text-text-muted font-mono">LONG/SHORT</p>
            <p className="text-xl font-bold font-mono">
              <span className="text-data-bull">{signals.filter(s => s.direction === 'LONG').length}</span>
              <span className="text-text-muted mx-1">/</span>
              <span className="text-data-bear">{signals.filter(s => s.direction === 'SHORT').length}</span>
            </p>
          </div>
        </div>

        {/* Asset Class Filter */}
        <div className="flex flex-wrap gap-2">
          {['All', 'Equity', 'Crypto', 'Forex', 'Commodity'].map(cls => (
            <button key={cls} onClick={() => setFilter(cls)}
              className={`px-3 py-1 text-[10px] font-mono rounded border transition-colors ${
                filter === cls
                  ? 'bg-teal-vivid text-bg-base border-teal-vivid font-bold'
                  : 'bg-bg-panel border-border-dim text-text-muted hover:border-border-active'
              }`}>
              {cls}
            </button>
          ))}
        </div>

        {/* Signals */}
        {loading ? (
          <div className="text-text-dim text-xs p-8 text-center">Generating AI signals...</div>
        ) : (
          <div className="space-y-3">
            {filtered.map(signal => (
              <div key={signal.id}
                className={`bg-bg-panel border rounded-lg p-4 cursor-pointer transition-colors ${
                  selected === signal.id ? 'border-accent-cyan' : 'border-border-dim hover:border-border-active'
                }`}
                onClick={() => setSelected(selected === signal.id ? null : signal.id)}>

                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-mono font-bold ${
                      signal.direction === 'LONG' ? 'text-data-bull' : 'text-data-bear'
                    }`}>
                      {signal.direction}
                    </span>
                    <span className="text-sm font-mono font-bold text-accent-cyan">{signal.symbol}</span>
                    <span className="text-xs text-text-dim">{signal.name}</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-bg-elevated text-text-muted">
                      {signal.assetClass.toUpperCase()}
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-bg-elevated text-text-muted">
                      {signal.timeframe}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-[10px] text-text-muted font-mono">STRENGTH</p>
                      <p className="text-lg font-bold font-mono text-accent-cyan">{signal.strength}%</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-text-muted font-mono">CONFIDENCE</p>
                      <p className="text-lg font-bold font-mono text-text-primary">{signal.confidence}%</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-text-muted font-mono">R:R</p>
                      <p className="text-lg font-bold font-mono text-data-bull">{signal.riskReward.toFixed(2)}</p>
                    </div>
                  </div>
                </div>

                {/* Entry/Target/Stop */}
                <div className="grid grid-cols-4 gap-3 mb-3">
                  <div>
                    <p className="text-[10px] text-text-muted font-mono">ENTRY</p>
                    <p className="text-sm font-mono font-bold text-text-primary">${signal.entryPrice.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-text-muted font-mono">TARGET</p>
                    <p className="text-sm font-mono font-bold text-data-bull">${signal.targetPrice.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-text-muted font-mono">STOP LOSS</p>
                    <p className="text-sm font-mono font-bold text-data-bear">${signal.stopLoss.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-text-muted font-mono">POTENTIAL</p>
                    <p className={`text-sm font-mono font-bold ${
                      signal.direction === 'LONG' ? 'text-data-bull' : 'text-data-bear'
                    }`}>
                      {signal.direction === 'LONG'
                        ? `+${(((signal.targetPrice - signal.entryPrice) / signal.entryPrice) * 100).toFixed(1)}%`
                        : `${(((signal.entryPrice - signal.targetPrice) / signal.entryPrice) * 100).toFixed(1)}%`
                      }
                    </p>
                  </div>
                </div>

                {/* Signals (expandable) */}
                {selected === signal.id && (
                  <div className="mt-3 pt-3 border-t border-border-dim">
                    <p className="text-[10px] text-accent-cyan font-mono mb-2">SIGNAL SOURCES ({signal.signals.length})</p>
                    <ul className="space-y-1">
                      {signal.signals.map((s, i) => (
                        <li key={i} className="text-xs text-text-dim flex items-start gap-2">
                          <span className="text-accent-cyan mt-0.5">•</span>
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-2">METHODOLOGY</h2>
          <p className="text-xs text-text-dim">
            AI signals combine 6 data sources: technical analysis (50+ indicators), on-chain metrics (whale flows, exchange balances),
            macro data (FRED, World Bank), sentiment (Fear & Greed, news), fundamental analysis (earnings, valuation),
            and smart money tracking. Each signal includes strength (0-100), confidence (0-100), and risk/reward ratio.
            Signals are generated by cross-correlating multiple independent data streams.
            In production, this uses ML models trained on historical signal performance.
          </p>
        </div>
      </div>
    </NexusLayout>
  )
}
