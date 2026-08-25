"use client"

import { useState, useEffect, useMemo } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { LiveDot } from '@/components/primitives/LiveDot'
import { HEATMAP_STOCKS } from '@/lib/config/universe'

interface HeatmapStock {
  symbol: string
  name: string
  sector: string
  change: number
  marketCap: number
  price: number
}


const SECTOR_COLORS: Record<string, string> = {
  Technology: '#3b82f6',
  Financial: '#f59e0b',
  Healthcare: '#10b981',
  Energy: '#ef4444',
  Consumer: '#8b5cf6',
  IDX: '#06b6d4',
}

export default function HeatmapPage() {
  const [data, setData] = useState<HeatmapStock[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const symbols = HEATMAP_STOCKS.map(s => s.symbol).join(',')
    fetch(`/api/v1/modules/fetch?module=yahoo-finance&action=quote&symbols=${symbols}`)
      .then(r => r.json())
      .then(d => {
        const items: HeatmapStock[] = (d.data ?? []).map((q: Record<string, unknown>) => ({
          symbol: q.symbol as string,
          name: (q.shortName ?? q.symbol) as string,
          sector: HEATMAP_STOCKS.find(s => s.symbol === q.symbol)?.sector ?? 'Unknown',
          change: (q.regularMarketChangePercent ?? 0) as number,
          marketCap: (q.marketCap ?? 0) as number,
          price: (q.regularMarketPrice ?? 0) as number,
        }))
        setData(items)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  // Group by sector
  const sectors = useMemo(() => {
    const groups: Record<string, HeatmapStock[]> = {}
    for (const stock of data) {
      if (!groups[stock.sector]) groups[stock.sector] = []
      groups[stock.sector].push(stock)
    }
    // Sort sectors by total market cap
    return Object.entries(groups)
      .map(([name, stocks]) => ({
        name,
        stocks: stocks.sort((a, b) => b.marketCap - a.marketCap),
        totalCap: stocks.reduce((sum, s) => sum + s.marketCap, 0),
      }))
      .sort((a, b) => b.totalCap - a.totalCap)
  }, [data])

  const getColor = (change: number) => {
    if (change >= 3) return '#166534' // dark green
    if (change >= 2) return '#15803d'
    if (change >= 1) return '#16a34a'
    if (change >= 0.5) return '#22c55e'
    if (change >= 0) return '#4ade80' // light green
    if (change >= -0.5) return '#fca5a5' // light red
    if (change >= -1) return '#f87171'
    if (change >= -2) return '#ef4444'
    if (change >= -3) return '#dc2626'
    return '#991b1b' // dark red
  }

  const getTextColor = (change: number) => {
    return Math.abs(change) >= 1.5 ? '#ffffff' : '#1f2937'
  }

  const getSize = (marketCap: number, sectorTotal: number) => {
    return Math.max(15, (marketCap / sectorTotal) * 100)
  }

  return (
    <NexusLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">MARKET HEATMAP</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              {data.length} stocks across {sectors.length} sectors — size by market cap, color by daily change
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : 'live'} label />
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-[10px] font-mono text-text-muted">
          <span>Color: daily % change</span>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: '#166534' }} />
            <span>+3%+</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: '#22c55e' }} />
            <span>+0.5%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: '#4ade80' }} />
            <span>0%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: '#f87171' }} />
            <span>-1%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: '#991b1b' }} />
            <span>-3%+</span>
          </div>
          <span className="ml-4">Size: market cap</span>
        </div>

        {loading ? (
          <div className="text-text-dim text-xs p-8 text-center">Loading heatmap data...</div>
        ) : (
          <div className="space-y-4">
            {sectors.map(sector => (
              <div key={sector.name} className="bg-bg-panel border border-border-dim rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-3 h-3 rounded" style={{ backgroundColor: SECTOR_COLORS[sector.name] ?? '#6b7280' }} />
                  <h2 className="text-xs font-mono text-accent-cyan">{sector.name.toUpperCase()}</h2>
                  <span className="text-[10px] text-text-muted font-mono">
                    ${sector.totalCap >= 1e12 ? `${(sector.totalCap / 1e12).toFixed(1)}T` : `${(sector.totalCap / 1e9).toFixed(0)}B`}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {sector.stocks.map(stock => {
                    const size = getSize(stock.marketCap, sector.totalCap)
                    return (
                      <div
                        key={stock.symbol}
                        className="rounded flex flex-col items-center justify-center cursor-default transition-transform hover:scale-105"
                        style={{
                          backgroundColor: getColor(stock.change),
                          color: getTextColor(stock.change),
                          minWidth: `${Math.max(size, 60)}px`,
                          minHeight: `${Math.max(size * 0.6, 40)}px`,
                          padding: '4px 8px',
                        }}
                        title={`${stock.name}: ${stock.change >= 0 ? '+' : ''}${stock.change.toFixed(2)}%`}
                      >
                        <span className="text-[10px] font-mono font-bold">{stock.symbol.replace('.JK', '')}</span>
                        <span className="text-[9px] font-mono">
                          {stock.change >= 0 ? '+' : ''}{stock.change.toFixed(2)}%
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </NexusLayout>
  )
}
