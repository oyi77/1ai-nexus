"use client"

import { useState, useEffect } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { LiveDot } from '@/components/primitives/LiveDot'
import { formatPriceUSD } from '@/lib/format'

interface Insight {
  id: string
  timestamp: string
  category: string
  title: string
  data: string
  source: string
}

export default function AiInsightsPage() {
  const [insights, setInsights] = useState<Insight[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const generate = async () => {
      try {
        const generated: Insight[] = []
        const now = new Date()

        // 1. Fetch real macro data
        try {
          const macroRes = await fetch('/api/v1/macro')
          const macroData = await macroRes.json()
          if (macroData.data?.indicators) {
            for (const ind of macroData.data.indicators.slice(0, 5)) {
              generated.push({
                id: `macro-${ind.id}`,
                timestamp: now.toISOString(),
                category: 'macro',
                title: ind.name ?? ind.id,
                data: `${ind.latestValue?.toLocaleString() ?? '—'} ${ind.unit ?? ''} (${ind.latestDate ?? ''})`,
                source: 'FRED / World Bank',
              })
            }
          }
        } catch { /* skip */ }

        // 2. Fetch real market data
        try {
          const symbols = ['SPY', 'QQQ', 'GLD', 'BTC-USD', 'EURUSD=X']
          const quoteRes = await fetch(`/api/v1/modules/fetch?module=yahoo-finance&action=quote&symbols=${symbols.join(',')}`)
          const quoteData = await quoteRes.json()
          for (const q of quoteData.data ?? []) {
            const change = q.regularMarketChangePercent ?? 0
            const price = q.regularMarketPrice ?? 0
            generated.push({
              id: `market-${q.symbol}`,
              timestamp: now.toISOString(),
              category: 'market',
              title: `${q.shortName ?? q.symbol}: ${formatPriceUSD(price)}`,
              data: `${change >= 0 ? '+' : ''}${change.toFixed(2)}% today`,
              source: 'Yahoo Finance',
            })
          }
        } catch { /* skip */ }

        // 3. Fetch real fear & greed
        try {
          const fgRes = await fetch('/api/v1/fear-greed')
          const fgData = await fgRes.json()
          if (fgData.data) {
            generated.push({
              id: 'fear-greed',
              timestamp: now.toISOString(),
              category: 'sentiment',
              title: `Fear & Greed Index: ${fgData.data.value ?? '—'}`,
              data: fgData.data.classification ?? '',
              source: 'Alternative.me',
            })
          }
        } catch { /* skip */ }

        // 4. Fetch treasury yields from our macro API (server-proxied)
        try {
          const macroRes = await fetch('/api/v1/macro')
          const macroData = await macroRes.json()
          const indicators = macroData.data?.indicators ?? []
          const dgs10 = indicators.find((i: { name?: string; seriesId?: string }) => i.seriesId === 'DGS10' || i.name?.includes('10-Year'))
          if (dgs10?.value != null) {
            generated.push({
              id: 'treasury-10y',
              timestamp: now.toISOString(),
              category: 'rates',
              title: 'US 10-Year Treasury Yield',
              data: `${dgs10.value}%`,
              source: 'US Treasury / FRED',
            })
          }
          const spread = indicators.find((i: { name?: string; seriesId?: string }) => i.seriesId === 'T10Y2Y' || i.name?.includes('Spread'))
          if (spread?.value != null) {
            generated.push({
              id: 'yield-spread',
              timestamp: now.toISOString(),
              category: 'rates',
              title: '10Y-2Y Yield Spread',
              data: `${spread.value}% — ${Number.parseFloat(String(spread.value)) > 0 ? 'Positive (no recession signal)' : 'Negative (recession signal)'}`,
              source: 'US Treasury / FRED',
            })
          }
        } catch { /* skip */ }

        // 5. Fetch forex from our API (server-proxied)
        try {
          const fxRes = await fetch('/api/v1/forex')
          const fxResp = await fxRes.json()
          const idr = fxResp.data?.pairs?.find((p: { pair?: string }) => p.pair?.includes('IDR'))?.rate ?? fxResp.data?.IDR
          if (idr) {
            generated.push({
              id: 'forex-usdidr',
              timestamp: now.toISOString(),
              category: 'forex',
              title: 'USD/IDR Exchange Rate',
              data: `IDR ${Number(idr).toFixed(2)}`,
              source: 'ExchangeRate-API',
            })
          }
        } catch { /* skip */ }


        setInsights(generated)
        setLoading(false)
      } catch (err) {
        setError((err as Error).message)
        setLoading(false)
      }
    }

    generate()
    const interval = setInterval(generate, 300000) // 5 min
    return () => clearInterval(interval)
  }, [])

  const categories = [...new Set(insights.map(i => i.category))]

  return (
    <NexusLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">AI MARKET INSIGHTS</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              {insights.length} insights from real data · FRED + Yahoo Finance + World Bank
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : error ? 'error' : 'live'} label />
        </div>

        {error && (
          <div className="text-data-bear text-[11px] font-mono p-4 bg-bg-panel border border-border-dim rounded">
            Error: {error}
          </div>
        )}

        {loading ? (
          <div className="text-text-dim text-xs p-8 text-center">Generating insights from real data...</div>
        ) : (
          <div className="space-y-4">
            {categories.map(cat => (
              <div key={cat} className="bg-bg-panel border border-border-dim rounded-lg p-4">
                <h2 className="text-xs font-mono text-accent-cyan mb-3">{cat.toUpperCase()}</h2>
                <div className="space-y-2">
                  {insights.filter(i => i.category === cat).map(insight => (
                    <div key={insight.id} className="flex items-center justify-between py-1 border-b border-border-dim/30">
                      <div>
                        <p className="text-xs font-mono text-text-primary">{insight.title}</p>
                        <p className="text-[10px] text-text-dim">{insight.data}</p>
                      </div>
                      <span className="text-[9px] font-mono text-text-muted">{insight.source}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-2">DATA SOURCES</h2>
          <p className="text-xs text-text-dim">
            All insights generated from real-time data. No hardcoded values.
            Sources: FRED API (22 macro series), Yahoo Finance (market data),
            World Bank (global macro), ExchangeRate-API (forex), Alternative.me (sentiment).
          </p>
        </div>
      </div>
    </NexusLayout>
  )
}
