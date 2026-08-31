"use client"

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { PriceTag } from '@/components/primitives/PriceTag'
import { AddressChip } from '@/components/primitives/AddressChip'
import { DeltaBadge } from '@/components/primitives/DeltaBadge'
import { LiveDot } from '@/components/primitives/LiveDot'
import { TradingViewChart } from '@/components/features/TradingViewChart'

interface TokenInfo {
  symbol: string
  name: string
  priceUsd: string
  fdvUsd: string
  marketCapUsd: string | null
  volumeUsd: { h24: string; h6: string; h1: string }
  priceChangePercentage: { h24: string; h6: string; h1: string }
  transactions: {
    h24: { buys: number; sells: number; buyers: number; sellers: number }
  }
  poolCreatedAt: string
}

interface OhlcvCandle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface OhlcvResponse {
  symbol: string
  interval: string
  candles: OhlcvCandle[]
  indicators: Record<string, unknown>
}

interface KnownHolder {
  address: string
  chain: string
  label: string
  type: string
  verified: boolean
  tvl: number
  isContract: boolean
}

interface HoldersResponse {
  token: {
    address: string
    symbol: string
    name: string
    price: number
    fdv: number
    marketCap: number
    totalSupply: number
    volume24h: number
    coingeckoId: string | null
  }
  knownHolders: KnownHolder[]
  distribution: Record<string, number>
  holderCount: number
  timestamp: number
}

interface ThesisSignal {
  id: string
  type: string
  asset: string
  direction: 'bullish' | 'bearish' | 'neutral'
  strength: number
  confidence: number
  headline: string
  explanation: string
  source: string
  timestamp: string
  route?: string
}

interface ThesisResponse {
  symbol: string
  thesis: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  weightedScore: number
  confidence: number
  counts: { bullish: number; bearish: number; neutral: number }
  totalSignals: number
  topSignals: ThesisSignal[]
}

const THESIS_STYLE: Record<string, string> = {
  BULLISH: 'bg-data-bull/20 text-data-bull',
  BEARISH: 'bg-data-bear/20 text-data-bear',
  NEUTRAL: 'bg-bg-raised text-text-muted',
}

const DIRECTION_STYLE: Record<string, string> = {
  bullish: 'text-data-bull',
  bearish: 'text-data-bear',
  neutral: 'text-text-muted',
}

const TYPE_STYLE: Record<string, string> = {
  exchange: 'bg-accent-amber/20 text-accent-amber',
  fund: 'bg-purple-400/20 text-purple-400',
  whale: 'bg-data-bull/20 text-data-bull',
  protocol: 'bg-teal-vivid/20 text-teal-vivid',
  bridge: 'bg-blue-400/20 text-blue-400',
}

const DISTRIBUTION_LABELS: Record<string, string> = {
  exchange: 'Exchanges',
  fund: 'Funds',
  protocol: 'Protocols',
  bridge: 'Bridges',
  whale: 'Whales',
}

function formatUsd(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return `$${v.toFixed(2)}`
}

export default function TokenDetailPage() {
  const params = useParams()
  const address = params?.address as string
  const [token, setToken] = useState<TokenInfo | null>(null)
  const [, setCandles] = useState<OhlcvCandle[]>([])
  const [, setIndicators] = useState<Record<string, Array<{ time: number; value: number }>>>({})
  const [interval, setIntervalStr] = useState('1h')
  const [status, setStatus] = useState<'live' | 'stale' | 'error'>('stale')
  const [holders, setHolders] = useState<HoldersResponse | null>(null)
  const [thesis, setThesis] = useState<ThesisResponse | null>(null)

  useEffect(() => {
    if (!address) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus('stale')

    // Fetch token info from GeckoTerminal
    fetch(`/api/v1/dex/trending?network=solana`)
      .then(r => r.json())
      .then(d => {
        const items = d.data?.items ?? []
        const found = items.find((i: Record<string, unknown>) => i.address === address)
        if (found) {
          setToken(found as unknown as TokenInfo)
          setStatus('live')
        } else {
          setStatus('error')
        }
      })
      .catch(() => setStatus('error'))
  }, [address])

  useEffect(() => {
    if (!token) return

    fetch(`/api/v1/ohlcv?symbol=${encodeURIComponent(token.symbol.split('/')[0])}&interval=${interval}&limit=100&indicators=sma20,ema50,bb`)
      .then(r => r.json())
      .then(d => {
        const data = d.data as OhlcvResponse
        if (data?.candles && data.candles.length > 0) {
          setCandles(data.candles)
          setIndicators(data.indicators as Record<string, Array<{ time: number; value: number }>>)
                  } else {
                  }
      })
      .catch(() => {})
  }, [token, interval])

  useEffect(() => {
    if (!address) return
    fetch(`/api/v1/token/holders?address=${encodeURIComponent(address)}&network=eth`)
      .then(r => r.json())
      .then(d => setHolders((d as { data: HoldersResponse }).data))
      .catch(() => {})
  }, [address])

  const thesisSymbol = holders?.token?.symbol || token?.symbol?.split('/')[0] || null

  useEffect(() => {
    if (!thesisSymbol) return
    fetch(`/api/v1/token/thesis?symbol=${encodeURIComponent(thesisSymbol)}`)
      .then(r => r.json())
      .then(d => setThesis((d as { data: ThesisResponse }).data))
      .catch(() => {})
  }, [thesisSymbol])

  return (
    <NexusLayout>
      <div className="p-4 space-y-4 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[24px] font-head font-bold text-text-primary">
              {token?.name ?? address.slice(0, 12) + '...'}
            </h1>
            <p className="text-xs text-text-muted mt-1">
              {address}
              {token && <span className="ml-2 text-teal-vivid">GeckoTerminal</span>}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {token && (
              <>
                <PriceTag value={parseFloat(token.priceUsd) || 0} size="lg" />
                <DeltaBadge value={parseFloat(token.priceChangePercentage?.h24 ?? '0')} size="sm" />
              </>
            )}
            <LiveDot status={status} label />
          </div>
        </div>

        {/* KPI Strip */}
        {token && (
          <div className="grid grid-cols-6 gap-2">
            <KPI label="FDV" value={`$${(parseFloat(token.fdvUsd) / 1e6).toFixed(2)}M`} />
            <KPI label="Vol 24h" value={`$${(parseFloat(token.volumeUsd?.h24 ?? '0') / 1e6).toFixed(2)}M`} />
            <KPI label="Vol 1h" value={`$${(parseFloat(token.volumeUsd?.h1 ?? '0') / 1e3).toFixed(1)}K`} />
            <KPI label="Buys 24h" value={String(token.transactions?.h24?.buys ?? 0)} />
            <KPI label="Sells 24h" value={String(token.transactions?.h24?.sells ?? 0)} />
            <KPI label="Change 1h" value={`${parseFloat(token.priceChangePercentage?.h1 ?? '0').toFixed(2)}%`} />
          </div>
        )}

        {/* Chart Panel */}
        <Panel title="Price Chart" subtitle="Real OHLCV from Binance" liveStatus="live">
          <div className="p-2">
            <div className="flex items-center gap-1 mb-2">
              {['5m', '15m', '1h', '4h', '1d'].map(tf => (
                <button
                  key={tf}
                  onClick={() => setIntervalStr(tf)}
                  className={`px-3 py-1 text-xs font-mono rounded uppercase transition-colors ${interval === tf ? 'bg-teal-vivid text-bg-base font-bold' : 'text-text-muted hover:text-text-primary bg-bg-raised'}`}
                >
                  {tf}
                </button>
              ))}
            </div>
            <TradingViewChart 
              symbol={`BINANCE:${token?.symbol?.split('/')[0]?.toUpperCase() ?? 'BTC'}USDT`}
              interval={interval === '5m' ? '5' : interval === '15m' ? '15' : interval === '1h' ? '60' : interval === '4h' ? '240' : 'D'}
              height={500}
              studies={['RSI', 'MACD', 'BB']}
            />
          </div>
        </Panel>

        {/* Transaction Analysis */}
        {token && (
          <div className="grid grid-cols-2 gap-4">
            <Panel title="Buy/Sell Pressure" subtitle="24h transaction breakdown">
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-data-bull">Buys</span>
                  <span className="text-[16px] font-mono font-bold text-data-bull tabular-nums">
                    {token.transactions?.h24?.buys ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-data-bear">Sells</span>
                  <span className="text-[16px] font-mono font-bold text-data-bear tabular-nums">
                    {token.transactions?.h24?.sells ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-bg-border pt-2">
                  <span className="text-xs font-mono text-text-muted">Buy/Sell Ratio</span>
                  <span className="text-[14px] font-mono font-bold text-text-primary tabular-nums">
                    {((token.transactions?.h24?.buys ?? 0) / Math.max(1, token.transactions?.h24?.sells ?? 1)).toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-text-muted">Unique Buyers</span>
                  <span className="text-[14px] font-mono text-text-primary tabular-nums">
                    {token.transactions?.h24?.buyers ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-text-muted">Unique Sellers</span>
                  <span className="text-[14px] font-mono text-text-primary tabular-nums">
                    {token.transactions?.h24?.sellers ?? 0}
                  </span>
                </div>
              </div>
            </Panel>

            <Panel title="Token Info" subtitle="Pool metadata">
              <div className="p-4 space-y-2">
                <Row label="Pool Created" value={token.poolCreatedAt ? new Date(token.poolCreatedAt).toLocaleString() : 'Unknown'} />
                <Row label="Market Cap" value={token.marketCapUsd ? `$${(parseFloat(token.marketCapUsd) / 1e6).toFixed(2)}M` : 'N/A'} />
                <Row label="FDV" value={`$${(parseFloat(token.fdvUsd) / 1e6).toFixed(2)}M`} />
                <Row label="24h Volume" value={`$${(parseFloat(token.volumeUsd?.h24 ?? '0') / 1e6).toFixed(2)}M`} />
                <Row label="6h Volume" value={`$${(parseFloat(token.volumeUsd?.h6 ?? '0') / 1e6).toFixed(2)}M`} />
                <Row label="1h Change" value={`${parseFloat(token.priceChangePercentage?.h1 ?? '0').toFixed(2)}%`} />
                <Row label="6h Change" value={`${parseFloat(token.priceChangePercentage?.h6 ?? '0').toFixed(2)}%`} />
              </div>
            </Panel>
          </div>
        )}

        {/* Top Holders */}
        {holders && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Panel title="Top Holders" subtitle={`${holders.holderCount} known wallets`} liveStatus="live">
              {holders.knownHolders.length === 0 ? (
                <div className="text-text-muted text-[12px] p-8 text-center">
                  No known holders found for this token.
                </div>
              ) : (
                <div className="divide-y divide-bg-border">
                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-4 py-1.5 text-[11px] font-mono text-text-muted uppercase tracking-wide">
                    <span>Address</span>
                    <span>Chain</span>
                    <span>Type</span>
                    <span className="text-right">TVL</span>
                  </div>
                  {holders.knownHolders.map((h, i) => (
                    <div
                      key={h.address}
                      className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center px-4 py-2 hover:bg-bg-raised/50 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[11px] font-mono text-text-muted w-4 shrink-0">{i + 1}</span>
                        <AddressChip address={h.address} truncate={6} size="xs" />
                        <span className="text-[12px] font-medium text-text-primary truncate">{h.label}</span>
                        {h.verified && (
                          <span className="text-teal-vivid text-[11px] shrink-0" title="Verified">✓</span>
                        )}
                      </div>
                      <span className="text-[11px] font-mono text-text-muted uppercase">{h.chain}</span>
                      <span className={`text-[11px] font-mono font-bold px-1.5 py-0.5 rounded ${TYPE_STYLE[h.type] ?? 'bg-bg-raised text-text-muted'}`}>
                        {h.type.toUpperCase()}
                      </span>
                      <span className="text-[12px] font-mono font-bold text-text-primary tabular-nums text-right">
                        {formatUsd(h.tvl)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            {/* Trade Thesis */}
            <Panel title="Trade Thesis" subtitle="Aggregated alpha signal thesis" liveStatus="live">
              {!thesis ? (
                <div className="text-text-muted text-[12px] p-8 text-center">
                  Loading trade thesis…
                </div>
              ) : thesis.totalSignals === 0 ? (
                <div className="text-text-muted text-[12px] p-8 text-center">
                  No alpha signals for this token yet.
                </div>
              ) : (
                <div className="p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className={`text-[16px] font-head font-bold px-2.5 py-1 rounded ${THESIS_STYLE[thesis.thesis] ?? 'bg-bg-raised text-text-muted'}`}>
                      {thesis.thesis}
                    </span>
                    <span className="text-xs font-mono text-text-muted">
                      Confidence{' '}
                      <span className="text-text-primary font-bold tabular-nums">{(thesis.confidence * 100).toFixed(0)}%</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-text-muted">Weighted Score</span>
                    <span className="text-[16px] font-mono font-bold text-text-primary tabular-nums">
                      {thesis.weightedScore.toFixed(1)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-t border-bg-border pt-2">
                    <span className="text-[11px] font-mono font-bold text-data-bull">▲ Bullish {thesis.counts.bullish}</span>
                    <span className="text-[11px] font-mono font-bold text-data-bear">▼ Bearish {thesis.counts.bearish}</span>
                    <span className="text-[11px] font-mono text-text-muted">◆ Neutral {thesis.counts.neutral}</span>
                  </div>
                  <div className="space-y-2 border-t border-bg-border pt-2">
                    {thesis.topSignals.map(s => (
                      <div key={s.id} className="rounded border border-bg-border bg-bg-raised/40 p-2">
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-[12px] font-medium text-text-primary leading-snug">{s.headline}</span>
                          <span className={`text-[11px] shrink-0 ${DIRECTION_STYLE[s.direction] ?? 'text-text-muted'}`}>
                            {s.direction === 'bullish' ? '▲' : s.direction === 'bearish' ? '▼' : '◆'}
                          </span>
                        </div>
                        <p className="text-[11px] text-text-muted mt-1 leading-snug">{s.explanation}</p>
                        <div className="flex items-center justify-between mt-1.5">
                          <span className="text-[10px] font-mono uppercase text-teal-vivid">{s.source}</span>
                          <span className="text-[10px] font-mono text-text-muted">STR {s.strength}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Panel>

            {/* Holder Distribution */}
            <Panel title="Holder Distribution" subtitle="By entity type" liveStatus="live">
              <div className="p-4 space-y-3">
                {Object.entries(DISTRIBUTION_LABELS).map(([key, label]) => {
                  const count = (holders.distribution as Record<string, number>)[key] ?? 0
                  const total = holders.holderCount
                  const pct = total > 0 ? (count / total) * 100 : 0
                  return (
                    <div key={key}>
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-xs font-mono font-bold ${TYPE_STYLE[key]?.split(' ')[1] ?? 'text-text-muted'}`}>
                          {label}
                        </span>
                        <span className="text-[13px] font-mono font-bold text-text-primary tabular-nums">
                          {count} <span className="text-text-muted text-[11px] font-normal">({pct.toFixed(0)}%)</span>
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-bg-raised overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${TYPE_STYLE[key]?.split(' ')[0]?.replace('/20', '/40') ?? 'bg-bg-elevated'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
                {(holders.holderCount === 0 || Object.values(holders.distribution as Record<string, number>).every(v => v === 0)) && (
                  <div className="text-text-muted text-[12px] text-center py-4">
                    No distribution data available.
                  </div>
                )}
              </div>
            </Panel>
          </div>
        )}
      </div>
    </NexusLayout>
  )
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-panel border border-bg-border px-3 py-2 rounded">
      <div className="text-xs text-text-muted font-mono uppercase mb-1">{label}</div>
      <div className="text-[16px] font-head font-bold tabular-nums text-text-primary">{value}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs font-mono text-text-muted">{label}</span>
      <span className="text-[12px] font-mono font-bold text-text-primary tabular-nums">{value}</span>
    </div>
  )
}