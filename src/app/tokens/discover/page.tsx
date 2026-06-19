"use client"

import { useState, useEffect } from "react"
import { TerminalShell } from "@/components/layout/TerminalShell"

interface TrendingToken {
  name: string
  symbol: string
  address: string
  network: string
  priceUsd: string
  volume24h: string
  change24h: string
  liquidity: string
  age: string
}

export default function TokenDiscoverPage() {
  const [tokens, setTokens] = useState<TrendingToken[]>([])
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<'trending' | 'new' | 'volume'>('trending')

  useEffect(() => {
    setLoading(true)
    const action = sort === 'new' ? 'new' : 'trending'
    fetch(`/api/v1/modules/fetch?module=geckoterminal&action=${action}&limit=30`)
      .then(r => r.json())
      .then(d => {
        const items = (d.data ?? []).map((p: Record<string, unknown>) => {
          const attrs = (p.attributes ?? {}) as Record<string, unknown>
          const network = (p.relationships as Record<string, Record<string, Record<string, string>>>)?.network?.data?.id ?? 'unknown'
          return {
            name: attrs.name ?? 'Unknown',
            symbol: (attrs.name as string)?.split(' / ')[0] ?? '?',
            address: attrs.address ?? '',
            network,
            priceUsd: attrs.base_token_price_usd ?? '0',
            volume24h: (attrs.volume_usd as Record<string, string>)?.h24 ?? '0',
            change24h: (attrs.price_change_percentage as Record<string, string>)?.h24 ?? '0',
            liquidity: attrs.reserve_in_usd ?? '0',
            age: attrs.pool_created_at ?? '',
          }
        })
        setTokens(items)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [sort])

  return (
    <TerminalShell>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold font-mono text-accent-cyan">TOKEN DISCOVERY</h1>
          <div className="flex gap-2">
            {(['trending', 'new', 'volume'] as const).map(s => (
              <button
                key={s}
                onClick={() => setSort(s)}
                className={`px-2 py-0.5 rounded text-xs border font-mono transition-colors ${
                  sort === s
                    ? 'bg-border-active border-border-active text-text-primary'
                    : 'bg-bg-panel border-border-dim text-text-dim hover:border-border-active'
                }`}
              >
                {s.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="text-text-dim text-xs">Loading trending tokens from GeckoTerminal...</div>
        ) : (
          <div className="bg-bg-panel border border-border-dim rounded-lg overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-text-muted border-b border-border-dim">
                  <th className="text-left py-2 px-3 font-mono">TOKEN</th>
                  <th className="text-left py-2 px-3 font-mono">NETWORK</th>
                  <th className="text-right py-2 px-3 font-mono">PRICE</th>
                  <th className="text-right py-2 px-3 font-mono">24H</th>
                  <th className="text-right py-2 px-3 font-mono">VOL 24H</th>
                  <th className="text-right py-2 px-3 font-mono">LIQ</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((t, i) => (
                  <tr key={i} className="border-b border-border-dim/30 hover:bg-bg-elevated cursor-pointer">
                    <td className="py-2 px-3">
                      <p className="font-mono text-text-primary">{t.symbol}</p>
                      <p className="text-text-muted text-[10px] truncate max-w-[200px]">{t.address}</p>
                    </td>
                    <td className="py-2 px-3 text-accent-cyan">{t.network}</td>
                    <td className="py-2 px-3 text-right font-mono">${Number(t.priceUsd).toFixed(6)}</td>
                    <td className={`py-2 px-3 text-right font-mono ${Number(t.change24h) >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                      {Number(t.change24h) >= 0 ? '+' : ''}{Number(t.change24h).toFixed(1)}%
                    </td>
                    <td className="py-2 px-3 text-right font-mono">${formatNum(Number(t.volume24h))}</td>
                    <td className="py-2 px-3 text-right font-mono">${formatNum(Number(t.liquidity))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </TerminalShell>
  )
}

function formatNum(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return n.toFixed(0)
}
