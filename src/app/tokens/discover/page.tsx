"use client"

import { useState, useEffect, useCallback } from "react"
import { TerminalShell } from "@/components/layout/TerminalShell"
import { TrendingUp, TrendingDown, AlertTriangle, Droplets, Clock } from "lucide-react"

interface DiscoveredToken {
  name: string
  symbol: string
  address: string
  network: string
  priceUsd: number
  volume24h: number
  liquidity: number
  change24h: number
  age: string
  rugScore: number
  smartMoneyPct: number
  badges: string[]
}

type SortMode = 'trending' | 'new' | 'volume' | 'liquidity'

export default function TokenDiscoverPage() {
  const [tokens, setTokens] = useState<DiscoveredToken[]>([])
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<SortMode>('trending')

  const fetchTokens = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/tokens/discover?sort=${sort}&limit=30`)
      const data = await res.json()
      setTokens(data.tokens ?? [])
    } catch {
      // Silent
    } finally {
      setLoading(false)
    }
  }, [sort])

  useEffect(() => { const invoke = () => fetchTokens(); invoke() }, [fetchTokens])

  return (
    <TerminalShell>
      <div className="h-full overflow-auto">
        {/* Header */}
        <div className="sticky top-0 bg-bg-deep z-10 px-4 py-3 border-b border-border-dim">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-sm font-mono font-bold text-accent-cyan">TOKEN DISCOVERY</h1>
              <span className="text-[10px] text-text-muted">{tokens.length} tokens</span>
            </div>
            <div className="flex gap-1">
              {([
                { key: 'trending', label: '🔥 TRENDING' },
                { key: 'new', label: '🆕 NEW' },
                { key: 'volume', label: '📊 VOLUME' },
                { key: 'liquidity', label: '💧 LIQUIDITY' },
              ] as const).map(s => (
                <button
                  key={s.key}
                  onClick={() => setSort(s.key)}
                  className={`px-2 py-0.5 rounded text-[10px] border font-mono transition-colors ${
                    sort === s.key
                      ? 'bg-border-active border-border-active text-text-primary'
                      : 'bg-bg-panel border-border-dim text-text-dim hover:border-border-active'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Token Table */}
        <div className="px-4 py-2">
          {loading ? (
            <div className="text-center py-20 text-text-dim text-xs">Scanning chains for tokens...</div>
          ) : tokens.length === 0 ? (
            <div className="text-center py-20 text-text-dim text-xs">No tokens found</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-text-muted text-[10px] uppercase">
                  <th className="text-left py-2 px-2 font-mono">#</th>
                  <th className="text-left py-2 px-2 font-mono">TOKEN</th>
                  <th className="text-left py-2 px-2 font-mono">CHAIN</th>
                  <th className="text-right py-2 px-2 font-mono">PRICE</th>
                  <th className="text-right py-2 px-2 font-mono">24H</th>
                  <th className="text-right py-2 px-2 font-mono">VOL 24H</th>
                  <th className="text-right py-2 px-2 font-mono">LIQUIDITY</th>
                  <th className="text-center py-2 px-2 font-mono">AGE</th>
                  <th className="text-center py-2 px-2 font-mono">RUG</th>
                  <th className="text-left py-2 px-2 font-mono">SIGNALS</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((t, i) => (
                  <tr
                    key={t.address + i}
                    className="border-t border-border-dim/30 hover:bg-bg-elevated cursor-pointer transition-colors"
                  >
                    <td className="py-2 px-2 text-text-muted">{i + 1}</td>
                    <td className="py-2 px-2">
                      <div>
                        <p className="font-mono text-text-primary text-[11px]">{t.symbol}</p>
                        <p className="text-[9px] text-text-muted truncate max-w-[140px]">{t.address}</p>
                      </div>
                    </td>
                    <td className="py-2 px-2">
                      <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                        t.network === 'solana' ? 'bg-purple-900/30 text-purple-400' :
                        t.network === 'eth' ? 'bg-blue-900/30 text-blue-400' :
                        'bg-gray-800 text-gray-400'
                      }`}>
                        {t.network.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-right font-mono">
                      {t.priceUsd < 0.000001 ? t.priceUsd.toExponential(2) :
                       t.priceUsd < 0.01 ? t.priceUsd.toFixed(6) :
                       t.priceUsd < 1 ? t.priceUsd.toFixed(4) :
                       `$${t.priceUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`}
                    </td>
                    <td className={`py-2 px-2 text-right font-mono ${t.change24h >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                      <span className="flex items-center justify-end gap-0.5">
                        {t.change24h >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                        {t.change24h >= 0 ? '+' : ''}{t.change24h.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-2 px-2 text-right font-mono">${formatNum(t.volume24h)}</td>
                    <td className="py-2 px-2 text-right font-mono">
                      <span className="flex items-center justify-end gap-1">
                        <Droplets size={10} className="text-accent-cyan" />
                        ${formatNum(t.liquidity)}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-center">
                      <span className="flex items-center justify-center gap-1 text-text-dim">
                        <Clock size={10} />
                        {t.age}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-center">
                      <RugScoreBadge score={t.rugScore} />
                    </td>
                    <td className="py-2 px-2">
                      <div className="flex flex-wrap gap-1">
                        {t.badges.map((b, j) => (
                          <span key={j} className="text-[9px] px-1 py-0.5 rounded bg-bg-elevated text-text-dim">
                            {b}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </TerminalShell>
  )
}

function RugScoreBadge({ score }: { score: number }) {
  if (score >= 70) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-mono text-accent-red">
        <AlertTriangle size={10} />
        {score}
      </span>
    )
  }
  if (score >= 40) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-mono text-accent-amber">
        <AlertTriangle size={10} />
        {score}
      </span>
    )
  }
  return (
    <span className="text-[10px] font-mono text-accent-green">{score}</span>
  )
}

function formatNum(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return n.toFixed(0)
}
