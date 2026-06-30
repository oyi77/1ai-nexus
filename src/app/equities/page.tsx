"use client"

import { useState, useEffect } from "react"
import { NexusLayout } from "@/components/layout/NexusLayout"

// Major global indices
const INDICES = ['^GSPC', '^IXIC', '^DJI', '^VIX', '^FTSE', '^N225', '^HSI', '^STOXX50E']
// Sector leaders + major global equities (US, EU, Asia, EM)
const GLOBAL_STOCKS = [
  // US Tech
  { symbol: 'AAPL', name: 'Apple', sector: 'Tech' },
  { symbol: 'MSFT', name: 'Microsoft', sector: 'Tech' },
  { symbol: 'GOOGL', name: 'Alphabet', sector: 'Tech' },
  { symbol: 'AMZN', name: 'Amazon', sector: 'Tech' },
  { symbol: 'NVDA', name: 'NVIDIA', sector: 'Tech/Semicon' },
  { symbol: 'TSLA', name: 'Tesla', sector: 'Auto' },
  { symbol: 'META', name: 'Meta', sector: 'Tech' },
  { symbol: 'AMD', name: 'AMD', sector: 'Tech/Semicon' },
  { symbol: 'AVGO', name: 'Broadcom', sector: 'Tech/Semicon' },
  // US Financial
  { symbol: 'JPM', name: 'JPMorgan Chase', sector: 'Financial' },
  { symbol: 'GS', name: 'Goldman Sachs', sector: 'Financial' },
  { symbol: 'V', name: 'Visa', sector: 'Financial' },
  { symbol: 'BAC', name: 'Bank of America', sector: 'Financial' },
  { symbol: 'BRK-B', name: 'Berkshire Hathaway', sector: 'Financial' },
  // US Healthcare
  { symbol: 'UNH', name: 'UnitedHealth', sector: 'Healthcare' },
  { symbol: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare' },
  { symbol: 'PFE', name: 'Pfizer', sector: 'Healthcare' },
  { symbol: 'LLY', name: 'Eli Lilly', sector: 'Healthcare' },
  // US Energy
  { symbol: 'XOM', name: 'Exxon Mobil', sector: 'Energy' },
  { symbol: 'CVX', name: 'Chevron', sector: 'Energy' },
  { symbol: 'COP', name: 'ConocoPhillips', sector: 'Energy' },
  // US Consumer
  { symbol: 'WMT', name: 'Walmart', sector: 'Consumer' },
  { symbol: 'NKE', name: 'Nike', sector: 'Consumer' },
  { symbol: 'MCD', name: 'McDonald\'s', sector: 'Consumer' },
  { symbol: 'KO', name: 'Coca-Cola', sector: 'Consumer' },
  { symbol: 'PG', name: 'Procter & Gamble', sector: 'Consumer' },
  // US Industrials
  { symbol: 'BA', name: 'Boeing', sector: 'Industrials' },
  { symbol: 'CAT', name: 'Caterpillar', sector: 'Industrials' },
  { symbol: 'GE', name: 'GE Aerospace', sector: 'Industrials' },
  { symbol: 'HON', name: 'Honeywell', sector: 'Industrials' },
  // EU
  { symbol: 'SAP.DE', name: 'SAP (Germany)', sector: 'Tech' },
  { symbol: 'TTE.PA', name: 'TotalEnergies (France)', sector: 'Energy' },
  { symbol: 'MC.PA', name: 'LVMH (France)', sector: 'Consumer' },
  { symbol: 'SIE.DE', name: 'Siemens (Germany)', sector: 'Industrials' },
  { symbol: 'NOVN.SW', name: 'Novartis (Switzerland)', sector: 'Healthcare' },
  { symbol: 'ROG.SW', name: 'Roche (Switzerland)', sector: 'Healthcare' },
  // Asia
  { symbol: '7203.T', name: 'Toyota (Japan)', sector: 'Auto' },
  { symbol: '6758.T', name: 'Sony (Japan)', sector: 'Tech' },
  { symbol: 'NTES', name: 'NetEase (China)', sector: 'Tech' },
  { symbol: 'BABA', name: 'Alibaba (China)', sector: 'Tech' },
  { symbol: '0700.HK', name: 'Tencent (HK)', sector: 'Tech' },
  // Crypto-adjacent (keep for reference)
  { symbol: 'MSTR', name: 'MicroStrategy', sector: 'Crypto' },
  { symbol: 'COIN', name: 'Coinbase', sector: 'Crypto' },
  { symbol: 'MARA', name: 'Marathon Digital', sector: 'Crypto' },
  { symbol: 'RIOT', name: 'Riot Platforms', sector: 'Crypto' },
  { symbol: 'CLSK', name: 'CleanSpark', sector: 'Crypto' },
  { symbol: 'HOOD', name: 'Robinhood', sector: 'Crypto' },
  { symbol: 'ARKK', name: 'ARK Innovation', sector: 'Crypto' },
]
export default function EquitiesPage() {
  const [quotes, setQuotes] = useState<Record<string, { price: number; change: number; name: string }>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const allSymbols = [...GLOBAL_STOCKS.map(s => s.symbol), ...INDICES].join(',')
    fetch(`/api/v1/modules/fetch?module=yahoo-finance&action=quote&symbols=${allSymbols}`)
      .then(r => r.json())
      .then(d => {
        const map: Record<string, { price: number; change: number; name: string }> = {}
        for (const q of d.data ?? []) {
          map[q.symbol] = { price: q.regularMarketPrice, change: q.regularMarketChangePercent, name: q.shortName ?? q.symbol }
        }
        setQuotes(map)
        setLoading(false)
      })
      .catch((err) => { setLoading(false); setError((err as Error).message) })
  }, [])

  // Group stocks by sector for display
  const sectors = [...new Set(GLOBAL_STOCKS.map(s => s.sector))]

  return (
    <NexusLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold font-mono text-accent-cyan">GLOBAL EQUITIES</h1>
          <span className="text-[10px] text-text-muted font-mono">{GLOBAL_STOCKS.length} stocks · {INDICES.length} indices</span>
        </div>
        {error && <div className="text-data-bear text-[11px] font-mono p-4">Error: {error}</div>}

        {/* Indices */}
        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-3">MAJOR INDICES</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {INDICES.map(sym => {
              const q = quotes[sym]
              return (
                <div key={sym} className="p-2">
                  <p className="text-[10px] text-text-muted">{q?.name ?? sym}</p>
                  <p className="text-lg font-mono font-bold">{q?.price?.toFixed(2) ?? '—'}</p>
                  <p className={`text-xs font-mono ${(q?.change ?? 0) >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                    {q?.change != null ? `${q.change >= 0 ? '+' : ''}${q.change.toFixed(2)}%` : '—'}
                  </p>
                </div>
              )
            })}
          </div>
        </div>

        {/* All Stocks by Sector */}
        {loading ? (
          <div className="text-text-dim text-xs p-8 text-center">Loading Yahoo Finance data for {GLOBAL_STOCKS.length} symbols...</div>
        ) : (
          sectors.map(sector => {
            const stocks = GLOBAL_STOCKS.filter(s => s.sector === sector).filter(s => quotes[s.symbol])
            if (stocks.length === 0) return null
            return (
              <div key={sector} className="bg-bg-panel border border-border-dim rounded-lg p-4">
                <h2 className="text-xs font-mono text-accent-cyan mb-3">{sector.toUpperCase()}</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-text-muted border-b border-border-dim">
                        <th className="text-left py-2 font-mono w-20">SYMBOL</th>
                        <th className="text-left py-2 font-mono">NAME</th>
                        <th className="text-right py-2 font-mono w-24">PRICE</th>
                        <th className="text-right py-2 font-mono w-20">CHANGE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stocks.map(s => {
                        const q = quotes[s.symbol]
                        if (!q) return null
                        return (
                          <tr key={s.symbol} className="border-b border-border-dim/30 hover:bg-bg-elevated">
                            <td className="py-2 font-mono text-accent-cyan">{s.symbol}</td>
                            <td className="py-2 text-text-dim">{s.name}</td>
                            <td className="py-2 text-right font-mono">{q.price?.toFixed(2) ?? '—'}</td>
                            <td className={`py-2 text-right font-mono ${(q.change ?? 0) >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                              {q.change != null ? `${q.change >= 0 ? '+' : ''}${q.change.toFixed(2)}%` : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })
        )}
      </div>
    </NexusLayout>
  )
}
