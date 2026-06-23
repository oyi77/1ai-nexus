"use client"

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { PriceTag } from '@/components/primitives/PriceTag'
import { DeltaBadge } from '@/components/primitives/DeltaBadge'
import { LiveDot } from '@/components/primitives/LiveDot'
import { CandlestickChart } from '@/components/features/CandlestickChart'

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

export default function TokenDetailPage() {
  const params = useParams()
  const address = params?.address as string
  const [token, setToken] = useState<TokenInfo | null>(null)
  const [candles, setCandles] = useState<OhlcvCandle[]>([])
  const [indicators, setIndicators] = useState<Record<string, Array<{ time: number; value: number }>>>({})
  const [interval, setIntervalStr] = useState('1h')
  const [status, setStatus] = useState<'live' | 'stale' | 'error'>('stale')
  const [chartStatus, setChartStatus] = useState<'loading' | 'live' | 'error'>('loading')

  useEffect(() => {
    if (!address) return
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
    setChartStatus('loading')

    // Map token symbol to Binance format for OHLCV
    const symbol = token.symbol.replace('/', '').replace('SOL', 'SOLUSDT').replace('USDT', 'USDT')
    const binanceSymbol = symbol.endsWith('USDT') ? symbol : `${symbol}USDT`

    fetch(`/api/v1/ohlcv?symbol=${encodeURIComponent(token.symbol.split('/')[0])}&interval=${interval}&limit=100&indicators=sma20,ema50,bb`)
      .then(r => r.json())
      .then(d => {
        const data = d.data as OhlcvResponse
        if (data?.candles && data.candles.length > 0) {
          setCandles(data.candles)
          setIndicators(data.indicators as Record<string, Array<{ time: number; value: number }>>)
          setChartStatus('live')
        } else {
          setChartStatus('error')
        }
      })
      .catch(() => setChartStatus('error'))
  }, [token, interval])

  return (
    <NexusLayout>
      <div className="p-4 space-y-4 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[24px] font-head font-bold text-text-primary">
              {token?.name ?? address.slice(0, 12) + '...'}
            </h1>
            <p className="text-[11px] text-text-muted font-mono mt-1">
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
        <Panel title="Price Chart" subtitle="Real OHLCV from Binance" liveStatus={chartStatus === 'live' ? 'live' : 'stale'}>
          <div className="p-2">
            <div className="flex items-center gap-1 mb-2">
              {['5m', '15m', '1h', '4h', '1d'].map(tf => (
                <button
                  key={tf}
                  onClick={() => setIntervalStr(tf)}
                  className={`px-3 py-1 text-[11px] font-mono rounded uppercase transition-colors ${interval === tf ? 'bg-teal-vivid text-bg-base font-bold' : 'text-text-muted hover:text-text-primary bg-bg-raised'}`}
                >
                  {tf}
                </button>
              ))}
            </div>
            {chartStatus === 'live' && candles.length > 0 ? (
              <CandlestickChart candles={candles} indicators={indicators} height={450} />
            ) : chartStatus === 'loading' ? (
              <div className="flex items-center justify-center h-[450px] text-[12px] font-mono text-text-muted">
                Loading candlestick data...
              </div>
            ) : (
              <div className="flex items-center justify-center h-[450px] text-[12px] font-mono text-text-muted">
                No OHLCV data for this token. Try a major pair (BTC, ETH, SOL).
              </div>
            )}
          </div>
        </Panel>

        {/* Transaction Analysis */}
        {token && (
          <div className="grid grid-cols-2 gap-4">
            <Panel title="Buy/Sell Pressure" subtitle="24h transaction breakdown">
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono text-data-bull">Buys</span>
                  <span className="text-[16px] font-mono font-bold text-data-bull tabular-nums">
                    {token.transactions?.h24?.buys ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono text-data-bear">Sells</span>
                  <span className="text-[16px] font-mono font-bold text-data-bear tabular-nums">
                    {token.transactions?.h24?.sells ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-bg-border pt-2">
                  <span className="text-[11px] font-mono text-text-muted">Buy/Sell Ratio</span>
                  <span className="text-[14px] font-mono font-bold text-text-primary tabular-nums">
                    {((token.transactions?.h24?.buys ?? 0) / Math.max(1, token.transactions?.h24?.sells ?? 1)).toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono text-text-muted">Unique Buyers</span>
                  <span className="text-[14px] font-mono text-text-primary tabular-nums">
                    {token.transactions?.h24?.buyers ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono text-text-muted">Unique Sellers</span>
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
      </div>
    </NexusLayout>
  )
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-panel border border-bg-border px-3 py-2 rounded">
      <div className="text-[10px] text-text-muted font-mono uppercase mb-1">{label}</div>
      <div className="text-[16px] font-head font-bold tabular-nums text-text-primary">{value}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] font-mono text-text-muted">{label}</span>
      <span className="text-[12px] font-mono font-bold text-text-primary tabular-nums">{value}</span>
    </div>
  )
}