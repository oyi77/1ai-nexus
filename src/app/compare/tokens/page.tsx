"use client"

import { useState, useEffect } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Search, X, Plus, TrendingUp, TrendingDown, Minus, BarChart3 } from 'lucide-react'

interface ConvictionItem {
  symbol: string
  name: string
  price: number
  changePct: number
  conviction: number
  action: 'BUY' | 'WAIT' | 'SELL'
  direction: 'bull' | 'bear' | 'neutral'
  reasons: Array<{ text: string; weight: number }>
  sources: string[]
}

const POPULAR = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'LINK', 'MATIC']

function convictionColor(c: number): string {
  if (c >= 80) return 'text-data-bull'
  if (c >= 60) return 'text-emerald-400'
  if (c >= 40) return 'text-amber-400'
  if (c >= 20) return 'text-orange-400'
  return 'text-data-bear'
}

function convictionBar(c: number): string {
  if (c >= 80) return 'bg-data-bull'
  if (c >= 60) return 'bg-emerald-400'
  if (c >= 40) return 'bg-amber-400'
  if (c >= 20) return 'bg-orange-400'
  return 'bg-data-bear'
}

export default function TokenComparePage() {
  const [symbols, setSymbols] = useState<string[]>(['BTC', 'ETH', 'SOL'])
  const [input, setInput] = useState('')
  const [tokens, setTokens] = useState<ConvictionItem[]>([])
  const [loading, setLoading] = useState(false)

  const fetchTokens = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/conviction')
      const data = await res.json()
      const items: ConvictionItem[] = []
      for (const market of data.markets || []) {
        for (const item of market.items || []) {
          if (symbols.includes(item.symbol)) {
            items.push(item)
          }
        }
      }
      setTokens(items)
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => {
    fetchTokens()
    const interval = setInterval(fetchTokens, 30_000)
    return () => clearInterval(interval)
  }, [symbols])

  const addSymbol = (s: string) => {
    const sym = s.toUpperCase()
    if (sym && !symbols.includes(sym) && symbols.length < 6) {
      setSymbols([...symbols, sym])
      setInput('')
    }
  }

  const removeSymbol = (s: string) => {
    setSymbols(symbols.filter(x => x !== s))
  }

  return (
    <NexusLayout>
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">TOKEN COMPARE</h1>
            <p className="text-xs text-text-muted mt-1">
              Compare conviction scores across tokens side by side
            </p>
          </div>
        </div>

        {/* Symbol selector */}
        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <div className="flex items-center gap-2 flex-wrap">
            {symbols.map(s => (
              <span key={s} className="flex items-center gap-1 px-2 py-1 bg-bg-rounded rounded text-sm font-mono">
                {s}
                <button onClick={() => removeSymbol(s)} className="text-text-muted hover:text-text-primary">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            <input
              type="text"
              placeholder="Add symbol..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addSymbol(input) }}
              className="px-2 py-1 text-sm font-mono rounded bg-bg-raised border border-border-dim text-text-primary placeholder:text-text-muted w-28"
            />
          </div>
          <div className="flex items-center gap-1 mt-2 flex-wrap">
            <span className="text-xs text-text-muted">Popular:</span>
            {POPULAR.filter(s => !symbols.includes(s)).slice(0, 6).map(s => (
              <button key={s} onClick={() => addSymbol(s)}
                className="px-1.5 py-0.5 text-xs font-mono rounded bg-bg-raised text-text-muted hover:text-text-primary">
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Comparison table */}
        {tokens.length > 0 && (
          <div className="bg-bg-panel border border-border-dim rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-text-muted border-b border-border-dim">
                  <th className="text-left p-3">TOKEN</th>
                  <th className="text-right p-3">PRICE</th>
                  <th className="text-right p-3">24H</th>
                  <th className="text-center p-3">CONVICTION</th>
                  <th className="text-center p-3">ACTION</th>
                  <th className="text-left p-3">TOP REASON</th>
                </tr>
              </thead>
              <tbody>
                {tokens.sort((a, b) => b.conviction - a.conviction).map(token => (
                  <tr key={token.symbol} className="border-b border-border-dim/50 hover:bg-bg-raised/50">
                    <td className="p-3">
                      <div className="font-mono font-bold">{token.symbol}</div>
                      <div className="text-xs text-text-muted">{token.name}</div>
                    </td>
                    <td className="p-3 text-right font-mono">${token.price.toFixed(2)}</td>
                    <td className={`p-3 text-right font-mono ${token.changePct >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                      {token.changePct >= 0 ? '+' : ''}{token.changePct.toFixed(2)}%
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-bg-rounded overflow-hidden">
                          <div className={`h-full ${convictionBar(token.conviction)}`} style={{ width: `${token.conviction}%` }} />
                        </div>
                        <span className={`font-mono font-bold w-10 text-right ${convictionColor(token.conviction)}`}>
                          {token.conviction}
                        </span>
                      </div>
                    </td>
                    <td className="p-3 text-center">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                        token.action === 'BUY' ? 'bg-data-bull/20 text-data-bull' :
                        token.action === 'SELL' ? 'bg-data-bear/20 text-data-bear' :
                        'bg-amber-500/20 text-amber-400'
                      }`}>
                        {token.action}
                      </span>
                    </td>
                    <td className="p-3 text-xs text-text-muted max-w-48 truncate">
                      {token.reasons[0]?.text || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tokens.length === 0 && !loading && (
          <div className="bg-bg-panel border border-border-dim rounded-lg p-8 text-center">
            <BarChart3 className="w-8 h-8 text-text-muted mx-auto mb-3" />
            <p className="text-text-muted">Add tokens to compare conviction scores</p>
          </div>
        )}
      </div>
    </NexusLayout>
  )
}
