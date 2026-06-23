"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'

interface TrendingToken {
  id: string
  name: string
  symbol: string
  marketCapRank: number
  priceUsd: number
  priceChange24h: number
  score: number
  thumb: string
}

interface GlobalData {
  totalMarketCap: number
  marketCapChange24h: number
  activeCryptos: number
  markets: number
}

function fmtUsd(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(2)}`
}

export default function TrendingCoinsPage() {
  const [tokens, setTokens] = useState<TrendingToken[]>([])
  const [global, setGlobal] = useState<GlobalData | null>(null)
  const [status, setStatus] = useState<'live' | 'stale' | 'error'>('stale')

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/trending-coins')
      const d = await res.json()
      if (d.success && d.data) {
        setTokens(d.data.tokens ?? [])
        setGlobal(d.data.global ?? null)
        setStatus('live')
      } else {
        setStatus('error')
      }
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, 120_000) // 2min
    return () => clearInterval(id)
  }, [fetchData])

  return (
    <NexusLayout>
      <div className="p-4 space-y-4 max-w-5xl mx-auto">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[24px] font-head font-bold text-text-primary flex items-center gap-2">
              <span className="text-accent-amber">🔥</span> Trending Coins
            </h1>
            <p className="text-[12px] text-text-muted font-mono mt-1">
              Top 15 trending tokens from CoinGecko. Updated every 2 minutes.
            </p>
          </div>
          <LiveDot status={status} label />
        </div>

        {/* Global Market */}
        {global && (
          <div className="grid grid-cols-4 gap-2">
            <KPI label="Total Market Cap" value={fmtUsd(global.totalMarketCap)} />
            <KPI label="24h Change" value={`${global.marketCapChange24h > 0 ? '+' : ''}${global.marketCapChange24h.toFixed(2)}%`} color={global.marketCapChange24h >= 0 ? 'text-data-bull' : 'text-data-bear'} />
            <KPI label="Active Cryptos" value={global.activeCryptos.toLocaleString()} />
            <KPI label="Markets" value={global.markets.toLocaleString()} />
          </div>
        )}

        {/* Trending Tokens */}
        <Panel title="Trending Now" subtitle="Most searched tokens on CoinGecko" liveStatus={status}>
          <div className="p-3 grid grid-cols-3 gap-3">
            {tokens.map((token, i) => (
              <a
                key={token.id}
                href={`/token/${token.id}`}
                className="bg-bg-raised p-4 rounded border border-bg-border hover:border-teal-vivid transition-colors"
              >
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-[14px] font-mono font-bold text-text-muted">#{i + 1}</span>
                  {token.thumb && <img src={token.thumb} alt={token.name} className="w-6 h-6 rounded-full" />}
                  <div>
                    <span className="text-[13px] font-mono font-bold text-text-primary">{token.symbol}</span>
                    <span className="text-[11px] font-mono text-text-muted ml-2">{token.name}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-mono text-text-secondary tabular-nums">
                    {fmtUsd(token.priceUsd)}
                  </span>
                  <span className={`text-[12px] font-mono font-bold tabular-nums ${
                    token.priceChange24h >= 0 ? 'text-data-bull' : 'text-data-bear'
                  }`}>
                    {token.priceChange24h > 0 ? '+' : ''}{token.priceChange24h.toFixed(2)}%
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] font-mono text-text-muted">
                    Rank: #{token.marketCapRank}
                  </span>
                  <span className="text-[10px] font-mono text-teal-vivid">
                    Score: {token.score}
                  </span>
                </div>
              </a>
            ))}
          </div>
        </Panel>
      </div>
    </NexusLayout>
  )
}

function KPI({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-bg-panel border border-bg-border p-3 rounded">
      <div className="text-[10px] text-text-muted font-mono uppercase mb-1">{label}</div>
      <div className={`text-[16px] font-head font-bold tabular-nums ${color ?? 'text-text-primary'}`}>{value}</div>
    </div>
  )
}