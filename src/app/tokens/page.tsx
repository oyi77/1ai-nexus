"use client"

import { useState, useEffect, useCallback } from "react"
import { TerminalShell } from "@/components/layout/TerminalShell"
import { TrendingUp, TrendingDown, Search } from "lucide-react"

interface Token {
  id: string
  symbol: string
  name: string
  current_price: number
  market_cap: number
  total_volume: number
  price_change_percentage_24h: number
  market_cap_rank: number
  image: string
}

export default function TokensPage() {
  const [tokens, setTokens] = useState<Token[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/modules/fetch?module=coingecko&action=markets&vs_currency=usd&per_page=50&page=${page}`)
      const data = await res.json()
      setTokens(data.data ?? [])
    } catch {
      // Silent
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => { fetchData() }, [fetchData])

  const filtered = tokens.filter(t =>
    !search ||
    t.symbol.toLowerCase().includes(search.toLowerCase()) ||
    t.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <TerminalShell>
      <div className="h-full overflow-auto">
        <div className="sticky top-0 bg-bg-deep z-10 px-4 py-3 border-b border-border-dim">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-sm font-mono font-bold text-accent-cyan">TOKEN MARKETS</h1>
            <span className="text-[10px] text-text-muted">{tokens.length} tokens · CoinGecko</span>
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1 max-w-xs">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search tokens..."
                className="w-full bg-bg-panel border border-border-dim rounded pl-7 pr-3 py-1 text-xs font-mono text-text-primary placeholder:text-text-muted focus:border-accent-cyan focus:outline-none"
              />
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="px-2 py-0.5 rounded text-[10px] border bg-bg-panel border-border-dim text-text-dim disabled:opacity-30"
              >← PREV</button>
              <span className="px-2 py-0.5 text-[10px] text-text-dim font-mono">PAGE {page}</span>
              <button
                onClick={() => setPage(page + 1)}
                className="px-2 py-0.5 rounded text-[10px] border bg-bg-panel border-border-dim text-text-dim"
              >NEXT →</button>
            </div>
          </div>
        </div>

        <div className="px-4 py-2">
          {loading ? (
            <div className="text-center py-20 text-text-dim text-xs">Loading token markets from CoinGecko...</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-text-muted text-[10px] uppercase">
                  <th className="text-left py-2 px-2 font-mono">#</th>
                  <th className="text-left py-2 px-2 font-mono">TOKEN</th>
                  <th className="text-right py-2 px-2 font-mono">PRICE</th>
                  <th className="text-right py-2 px-2 font-mono">24H</th>
                  <th className="text-right py-2 px-2 font-mono">MARKET CAP</th>
                  <th className="text-right py-2 px-2 font-mono">VOLUME 24H</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => (
                  <tr key={t.id} className="border-t border-border-dim/30 hover:bg-bg-elevated cursor-pointer transition-colors">
                    <td className="py-2 px-2 text-text-muted">{t.market_cap_rank}</td>
                    <td className="py-2 px-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-text-primary font-bold uppercase">{t.symbol}</span>
                        <span className="text-text-dim text-[10px]">{t.name}</span>
                      </div>
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-text-primary">
                      ${t.current_price?.toLocaleString('en-US', { maximumFractionDigits: 2 }) ?? '—'}
                    </td>
                    <td className={`py-2 px-2 text-right font-mono flex items-center justify-end gap-0.5 ${t.price_change_percentage_24h >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                      {t.price_change_percentage_24h >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                      {t.price_change_percentage_24h != null ? `${t.price_change_percentage_24h >= 0 ? '+' : ''}${t.price_change_percentage_24h.toFixed(2)}%` : '—'}
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-text-dim">
                      ${formatLargeNumber(t.market_cap)}
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-text-dim">
                      ${formatLargeNumber(t.total_volume)}
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

function formatLargeNumber(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`
  return n.toLocaleString()
}
