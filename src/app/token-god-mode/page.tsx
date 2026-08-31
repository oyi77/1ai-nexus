"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'
import { useTableControls, TableControlsBar, SortableTh } from '@/components/shell/TableControls'

interface Holder {
  address: string
  chain: string
  entityName: string | null
  entityType: string | null
  entityTvl: number
  verified: boolean
  smartMoneyScore: number
}

type Pool = {
  address: string
  name: string
  dex: string
  priceUsd: number
  volume24h: number
  liquidity: number
}

interface TokenData {
  token: {
    address: string
    name: string
    symbol: string
    price: number
    fdv: number
    marketCap: number
    volume24h: number
    priceChange24h: number
    totalSupply: string
  }
  holders: Holder[]
  entityDistribution: Record<string, { count: number; tvl: number }>
  topHolders: Array<{ name: string; type: string; tvl: number; score: number }>
  pools: Pool[]
}

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(2)}`
}

const typeColors: Record<string, string> = {
  exchange: 'bg-accent-amber/20 text-accent-amber',
  fund: 'bg-purple-400/20 text-purple-400',
  whale: 'bg-data-bull/20 text-data-bull',
  protocol: 'bg-teal-vivid/20 text-teal-vivid',
  bridge: 'bg-data-bear/20 text-data-bear',
}

interface TrendingToken {
  address: string
  name: string
  symbol: string
  network: string
  priceUsd: number
  volume24h: number
  priceChange24h: number
  liquidity: number
  fdv: number
}

export default function TokenGodModePage() {
  const [address, setAddress] = useState('')
  const [network, setNetwork] = useState('eth')
  const [data, setData] = useState<TokenData | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'live' | 'error'>('idle')
  const [trending, setTrending] = useState<TrendingToken[]>([])
  const [, setTrendingLoading] = useState(true)
  const poolsTc = useTableControls(data?.pools, undefined, { initialSortKey: 'liquidity', initialSortDir: 'desc' })

  // Popular tokens for quick analysis
  const POPULAR_TOKENS = [
    { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', name: 'USDT', network: 'eth' },
    { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', name: 'USDC', network: 'eth' },
    { address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', name: 'AAVE', network: 'eth' },
    { address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', name: 'UNI', network: 'eth' },
    { address: '0x514910771af9ca656af840dff83e8264ecf986ca', name: 'LINK', network: 'eth' },
    { address: '0x6b175474e89094c44da98b954eedeac495271d0f', name: 'DAI', network: 'eth' },
  ]

  // Fetch trending tokens from DexScreener on mount
  useEffect(() => {
    fetch('/api/v1/dex/boosted', { signal: AbortSignal.timeout(10_000) })
      .then(r => r.json())
      .then((data: Array<{ chainId: string; tokenAddress: string; description?: string; links?: Array<{ label?: string }> }>) => {
        const tokens: TrendingToken[] = data.slice(0, 12).map(t => ({
          address: t.tokenAddress,
          name: t.description ?? t.tokenAddress.slice(0, 8),
          symbol: t.links?.[0]?.label ?? t.tokenAddress.slice(0, 6),
          network: t.chainId === 'solana' ? 'solana' : 'eth',
          priceUsd: 0,
          volume24h: 0,
          priceChange24h: 0,
          liquidity: 0,
          fdv: 0,
        }))
        setTrending(tokens)
        setTrendingLoading(false)
      })
      .catch(() => setTrendingLoading(false))
  }, [])

  const fetchToken = useCallback(async () => {
    if (!address.trim()) return
    setStatus('loading')
    try {
      const res = await fetch(`/api/v1/token/god-mode?address=${encodeURIComponent(address)}&network=${network}`)
      const d = await res.json()
      if (d.data) {
        setData(d.data as TokenData)
        setStatus('live')
      } else {
        setStatus('error')
      }
    } catch {
      setStatus('error')
    }
  }, [address, network])

  // Auto-fetch when address changes (from preset click)
  useEffect(() => {
    if (address.trim() && status !== 'loading') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchToken()
    }
    // status is intentionally excluded from deps: including it would refetch
    // on every status flip (loading→live→loading…), causing an infinite loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, network, fetchToken])

  return (
    <NexusLayout>
      <div className="p-4 space-y-4 max-w-7xl mx-auto">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[24px] font-head font-bold text-text-primary flex items-center gap-2">
              <span className="text-teal-vivid">🔬</span> Token God Mode
            </h1>
            <p className="text-[12px] text-text-muted mt-1">
              Deep analysis of any token — holders, pools, entity attribution. Inspired by Nansen.
            </p>
          </div>
          <LiveDot status={status === 'live' ? 'live' : status === 'error' ? 'error' : 'stale'} label />
        </div>

        {/* Search */}
        <Panel title="Token Analysis" subtitle="Enter any token contract address">
          <div className="p-3 space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={address}
                onChange={e => setAddress(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') fetchToken() }}
                placeholder="0x... or token address"
                className="flex-1 bg-bg-raised border border-bg-border rounded px-3 py-2 text-[12px] font-mono text-text-primary placeholder:text-text-muted outline-none focus:border-teal-vivid"
              />
              <select
                value={network}
                onChange={e => setNetwork(e.target.value)}
                className="bg-bg-raised border border-bg-border rounded px-3 py-2 text-[12px] font-mono text-text-primary"
              >
                <option value="eth">Ethereum</option>
                <option value="bsc">BNB Chain</option>
                <option value="arbitrum">Arbitrum</option>
                <option value="base">Base</option>
                <option value="solana">Solana</option>
                <option value="polygon">Polygon</option>
              </select>
              <button
                onClick={fetchToken}
                disabled={status === 'loading'}
                className="px-4 py-2 bg-teal-vivid text-bg-base rounded text-xs font-bold hover:bg-teal-vivid/80 transition-colors disabled:opacity-50"
              >
                {status === 'loading' ? 'Scanning...' : 'ANALYZE'}
              </button>
            </div>
          </div>
        </Panel>

        {/* Quick Start: Trending + Popular */}
        {!data && (
          <div className="space-y-3">
            {/* Trending tokens from DexScreener */}
            {trending.length > 0 && (
              <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
                <h3 className="text-xs text-accent-amber mb-2">TRENDING NOW (DexScreener)</h3>
                <p className="text-xs text-text-muted mb-3">Top boosted tokens — click to analyze</p>
                <div className="flex flex-wrap gap-2">
                  {trending.map(token => (
                    <button key={token.address} onClick={() => { setAddress(token.address); setNetwork(token.network) }}
                      className="px-3 py-1.5 text-xs font-mono border border-accent-amber/30 rounded hover:border-accent-amber hover:bg-bg-elevated transition-colors">
                      <span className="text-accent-amber font-bold">{token.symbol}</span>
                      <span className="text-text-muted ml-1">{token.network}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Popular blue-chip tokens */}
            <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
              <h3 className="text-xs text-accent-cyan mb-2">BLUE CHIPS</h3>
              <p className="text-xs text-text-muted mb-3">Major tokens — click to analyze</p>
              <div className="flex flex-wrap gap-2">
                {POPULAR_TOKENS.map(token => (
                  <button key={token.address} onClick={() => { setAddress(token.address); setNetwork(token.network) }}
                    className="px-3 py-1.5 text-xs font-mono border border-border-dim rounded hover:border-teal-vivid hover:bg-bg-elevated transition-colors">
                    <span className="text-accent-cyan font-bold">{token.name}</span>
                    <span className="text-text-muted ml-1">{token.network}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Token Info */}
        {data && (
          <>
            <div className="grid grid-cols-6 gap-2">
              <KPI label="Price" value={`$${data.token.price.toLocaleString(undefined, { maximumFractionDigits: 6 })}`} />
              <KPI label="24h" value={`${data.token.priceChange24h > 0 ? '+' : ''}${data.token.priceChange24h.toFixed(2)}%`} color={data.token.priceChange24h >= 0 ? 'text-data-bull' : 'text-data-bear'} />
              <KPI label="FDV" value={fmtUsd(data.token.fdv)} />
              <KPI label="Volume 24h" value={fmtUsd(data.token.volume24h)} />
              <KPI label="Pools" value={String(data.pools.length)} />
              <KPI label="Known Holders" value={String(data.holders.length)} />
            </div>

            {/* Pools */}
            <Panel title="Liquidity Pools" subtitle={`${data.pools.length} pools from GeckoTerminal`}>
                <TableControlsBar idPrefix="token-god-mode" query={poolsTc.query} onQueryChange={poolsTc.setQuery} shown={poolsTc.visible.length} total={poolsTc.total} />
              <div className="overflow-auto scrollbar-thin">
                <table className="w-full border-separate border-spacing-0">
                  <thead>
                    <tr className="text-text-muted">
                      <SortableTh controls={poolsTc} k="name" className="text-xs font-mono uppercase px-3 py-2 border-b border-bg-border text-left">Pool</SortableTh>
                      <SortableTh controls={poolsTc} k="dex" className="text-xs font-mono uppercase px-3 py-2 border-b border-bg-border text-left">DEX</SortableTh>
                      <SortableTh controls={poolsTc} k="priceUsd" className="text-xs font-mono uppercase px-3 py-2 border-b border-bg-border text-right">Price</SortableTh>
                      <SortableTh controls={poolsTc} k="volume24h" className="text-xs font-mono uppercase px-3 py-2 border-b border-bg-border text-right">Volume 24h</SortableTh>
                      <SortableTh controls={poolsTc} k="liquidity" className="text-xs font-mono uppercase px-3 py-2 border-b border-bg-border text-right">Liquidity</SortableTh>
                    </tr>
                  </thead>
                  <tbody>
                    {poolsTc.visible.map((p, i) => (
                      <tr key={i} className="border-b border-bg-border/30 hover:bg-bg-raised transition-colors">
                        <td className="text-xs font-mono px-3 py-1.5 text-text-primary font-bold">{p.name}</td>
                        <td className="text-xs font-mono px-3 py-1.5 text-teal-vivid">{p.dex}</td>
                        <td className="text-xs font-mono px-3 py-1.5 text-right text-text-primary tabular-nums">${p.priceUsd.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                        <td className="text-xs font-mono px-3 py-1.5 text-right text-text-secondary tabular-nums">{fmtUsd(p.volume24h)}</td>
                        <td className="text-xs font-mono px-3 py-1.5 text-right text-text-secondary tabular-nums">{fmtUsd(p.liquidity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            {/* Known Holders */}
            <Panel title="Known Holders" subtitle={`${data.holders.length} entities identified from database`}>
              <div className="p-3 grid grid-cols-2 gap-3">
                {data.holders.map((h, i) => (
                  <div key={i} className="bg-bg-raised p-3 rounded border border-bg-border">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[12px] font-mono font-bold text-text-primary">{h.entityName ?? 'Unknown'}</span>
                      {h.verified && <span className="text-teal-vivid text-xs">✓</span>}
                    </div>
                    <div className="flex items-center gap-2 mb-1">
                      {h.entityType && (
                        <span className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded ${typeColors[h.entityType] ?? 'bg-bg-raised text-text-muted'}`}>
                          {h.entityType.toUpperCase()}
                        </span>
                      )}
                      <span className="text-xs font-mono text-text-muted">{h.chain}</span>
                    </div>
                    <div className="text-xs font-mono text-text-muted">TVL: {fmtUsd(h.entityTvl)}</div>
                    <div className="text-xs font-mono text-text-muted mt-1">{h.address.slice(0, 16)}...</div>
                  </div>
                ))}
              </div>
            </Panel>

            {/* Entity Distribution */}
            <Panel title="Entity Distribution" subtitle="Holder composition by type">
              <div className="p-3 grid grid-cols-5 gap-3">
                {Object.entries(data.entityDistribution).map(([type, dist]) => (
                  <div key={type} className="bg-bg-raised p-3 rounded border border-bg-border">
                    <div className="text-xs font-mono text-text-muted uppercase mb-1">{type}</div>
                    <div className="text-[16px] font-head font-bold text-text-primary">{dist.count}</div>
                    <div className="text-xs font-mono text-text-muted">TVL: {fmtUsd(dist.tvl)}</div>
                  </div>
                ))}
              </div>
            </Panel>
          </>
        )}
      </div>
    </NexusLayout>
  )
}

function KPI({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-bg-panel border border-bg-border p-3 rounded">
      <div className="text-xs text-text-muted font-mono uppercase mb-1">{label}</div>
      <div className={`text-[16px] font-head font-bold tabular-nums ${color ?? 'text-text-primary'}`}>{value}</div>
    </div>
  )
}