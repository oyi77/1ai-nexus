"use client"

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { StatCard } from '@/components/domain/stat-card'
import type {
  GateioPerformanceData,
  GateioLeaderProfile,
  GateioEquityPoint,
  GateioMarketConcentration,
  GateioTrade,
} from '@/lib/modules/derivatives/gateio/performance'
import type {
  BinancePerformanceData,
  BinanceLeaderProfile,
  BinanceEquityPoint,
  BinanceMarketConcentration,
  BinancePosition,
} from '@/lib/modules/derivatives/binance/performance'
import type { CopyTradingLeader, CopyTradingPlatform } from '@/lib/modules/market/copy-trading/types'
import { COPY_TRADING_PLATFORMS } from '@/lib/modules/market/copy-trading/types'

const EMPTY: GateioPerformanceData = { profile: null, equity: [], markets: [], trades: [] }

/**
 * OKX deep-leader extras beyond the shared CopyTradingLeader shape.
 * Mirrored locally — the okx-copy module must never be imported from a client
 * bundle (it pulls in server-only `crypto`/`redis` deps).
 */
interface OkxLeaderDetail extends CopyTradingLeader {
  labels: string[]
  lever: number
  tier: string | null
  profitShare: number
  positions?: unknown[]
  equityCurve: Array<{ statTime: number; ratio: number }>
}

/**
 * Bitget deep-leader extras beyond the shared CopyTradingLeader shape.
 * Mirrored locally (the bitget-copy module is server-only) and all optional —
 * the API may return a plain leaderboard-shaped leader when the deep fields
 * are absent.
 */
interface BitgetLeaderDetail extends CopyTradingLeader {
  copierProfit?: number
  score?: number
  portfolioId?: string | null
  equityCurve?: Array<{ amount: number; dataTime: number | null }>
}

/**
 * Hyperliquid deep-leader extras beyond the shared CopyTradingLeader shape.
 * Mirrored locally; `windowPerformances` carries ALL periods the stats-data
 * dump reports (day/week/month/allTime), not just the active cycle.
 */
interface HyperliquidLeaderDetail extends CopyTradingLeader {
  windowPerformances?: Array<{ window: string; pnl: number; roi: number; vlm: number }>
}

const PLATFORM_LABELS: Record<CopyTradingPlatform, string> = {
  gateio: 'Gate.io',
  hyperliquid: 'Hyperliquid',
  binance: 'Binance',
  bybit: 'Bybit',
  okx: 'OKX',
  bitget: 'Bitget',
}

function platformLabel(p: CopyTradingPlatform): string {
  return PLATFORM_LABELS[p] ?? p
}

/** Normalize a raw `platform` query value; unknown/missing values fall back to gateio. */
function parsePlatform(raw: string | null): CopyTradingPlatform {
  const value = (raw ?? 'gateio').toLowerCase()
  return (COPY_TRADING_PLATFORMS as readonly string[]).includes(value) ? (value as CopyTradingPlatform) : 'gateio'
}

/** Sort-stable platforms with a registered per-leader performance module. */
const PLATFORMS_WITH_PERFORMANCE: CopyTradingPlatform[] = ['gateio', 'binance']

/** Hyperliquid stats-data dump windows and their UI labels (all 4 periods). */
const HL_WINDOWS = [
  { key: 'day', label: '1D' },
  { key: 'week', label: '7D' },
  { key: 'month', label: '30D' },
  { key: 'allTime', label: 'All' },
] as const

type HlWindowPerf = { pnl: number; roi: number; vlm: number }

/** Row descriptors for the window-performance table. */
const HL_ROWS: Array<{ label: string; value: (p: HlWindowPerf) => string | null }> = [
  { label: 'PnL', value: (p) => (Number.isFinite(p.pnl) && p.pnl !== 0 ? fmtUsd(p.pnl) : null) },
  { label: 'ROI', value: (p) => (Number.isFinite(p.roi) && p.roi !== 0 ? fmtPct(p.roi, 2) : null) },
  { label: 'Volume', value: (p) => (Number.isFinite(p.vlm) && p.vlm !== 0 ? fmtUsd(p.vlm) : null) },
]

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}

function fmtPct(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`
}

function fmtHold(seconds: number): string {
  if (seconds <= 0) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function fmtTime(ts: number): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString()
}

function EquityCurve({ points, valueKind = 'usd' }: { points: GateioEquityPoint[]; valueKind?: 'usd' | 'ratio' }) {
  if (points.length === 0) {
    return <div className="py-10 text-center text-sm text-text-muted">No equity curve data</div>
  }
  const w = 600
  const h = 160
  const pad = 10
  const vals = points.map((p) => p.profit)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const range = max - min || 1
  const pts = points
    .map((p, i) => {
      const x = pad + (i / Math.max(points.length - 1, 1)) * (w - 2 * pad)
      const y = h - pad - ((p.profit - min) / range) * (h - 2 * pad)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  const last = points[points.length - 1]
  // OKX cumulative yield is a 0..1 ratio — render as %, not $.
  const display = valueKind === 'ratio' ? fmtPct(last.profit, 2) : fmtUsd(last.profit)
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-3">
        <span className="font-mono text-2xl text-teal-vivid">{display}</span>
        <span className="text-xs text-text-muted">
          {points.length} points · {new Date(last.timestamp * 1000).toLocaleDateString()}
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-40 w-full text-teal-vivid" role="img" aria-label={valueKind === 'ratio' ? 'Cumulative yield curve' : 'Profit curve'}>
        <line x1={pad} y1={h / 2} x2={w - pad} y2={h / 2} stroke="currentColor" strokeOpacity={0.15} strokeDasharray="4 4" />
        <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  )
}

function Concentration({ rows }: { rows: GateioMarketConcentration[] }) {
  if (rows.length === 0) {
    return <div className="py-10 text-center text-sm text-text-muted">No position concentration data</div>
  }
  const top = rows.slice(0, 8)
  return (
    <div className="space-y-3">
      {top.map((r) => (
        <div key={r.symbol}>
          <div className="mb-1 flex justify-between text-xs">
            <span className="font-mono text-text-primary">{r.symbol}</span>
            <span className="text-text-muted">{fmtPct(r.percent)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-bg-raised">
            <div
              className="h-full rounded-full bg-teal-vivid"
              style={{ width: `${Math.min(r.percent * 100, 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function ProfileHeader({ profile }: { profile: GateioLeaderProfile }) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      {profile.avatar && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={profile.avatar} alt={profile.nickname} className="h-14 w-14 rounded-full object-cover" />
      )}
      <div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold text-text-primary">{profile.nickname}</span>
          {profile.tier > 0 && (
            <span className="rounded bg-bg-raised px-1.5 py-0.5 text-xs text-text-muted">T{profile.tier}</span>
          )}
          {profile.level > 0 && (
            <span className="rounded bg-bg-raised px-1.5 py-0.5 text-xs text-text-muted">Lv{profile.level}</span>
          )}
          {profile.status && <span className="capitalize text-xs text-text-muted">{profile.status}</span>}
        </div>
        {profile.nick && <div className="text-xs text-text-muted">{profile.nick}</div>}
        {profile.style && <div className="mt-0.5 font-mono text-xs text-text-muted">{profile.style}</div>}
      </div>
    </div>
  )
}

/** Basic profile header built from a normalized leaderboard row (no performance module yet). */
function LeaderRowHeader({ leader, tier = null }: { leader: CopyTradingLeader; tier?: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      {leader.avatar && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={leader.avatar} alt={leader.nick} className="h-14 w-14 rounded-full object-cover" />
      )}
      <div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold text-text-primary">{leader.nick || leader.id}</span>
          {leader.level > 0 && (
            <span className="rounded bg-bg-raised px-1.5 py-0.5 text-xs text-text-muted">Lv{leader.level}</span>
          )}
          {tier && <span className="rounded bg-bg-raised px-1.5 py-0.5 text-xs text-text-muted">{tier}</span>}
          <span className="rounded bg-bg-raised px-1.5 py-0.5 text-xs text-text-muted">{platformLabel(leader.platform)}</span>
          {leader.isPrivate && (
            <span className="rounded bg-bg-raised px-1.5 py-0.5 text-xs text-text-muted">private</span>
          )}
        </div>
        <div className="text-xs text-text-muted">{leader.id}</div>
      </div>
    </div>
  )
}

/** Adapt a Binance lead-portfolio profile into the Gateio-shaped render profile. */
function adaptBinanceProfile(p: BinanceLeaderProfile | null): GateioLeaderProfile | null {
  if (!p) return null
  return {
    id: 0, // Binance uses a 19-digit string id; never round-trip it through a number.
    nickname: p.nickName,
    nick: p.nickNameTranslate ?? '',
    avatar: p.avatar ?? '',
    tier: 0, // Binance exposes no tier.
    hideName: '',
    status: p.status ?? '',
    style: p.futuresType ?? '',
    abstract: p.description ?? '',
    level: 0, // Binance exposes no leader level.
    feeRate: p.profitSharingRatio ?? 0,
    minFollow: 0,
    maxFollow: p.maxCopyCount ?? 0,
    markets: [], // Binance exposes no tradable-market list.
    stats: {
      tradeNum: p.totalCopyCount ?? 0,
      winNum: 0,
      lossNum: 0,
      winRate: 0, // Not exposed — rendered as omitted for Binance.
      totalInvest: p.marginBalance ?? 0,
      profit: p.pnl ?? 0,
      profitRate: p.roi ?? 0,
      aum: p.aum ?? 0,
      maxDrawdown: 0, // Not exposed — rendered as omitted for Binance.
      sharpRatio: p.sharpeRatio ?? 0,
      followProfit: 0, // Not exposed — rendered as omitted for Binance.
      currFollowNum: p.followerNum ?? 0,
      maxFollowNum: p.maxCopyCount ?? 0,
      unrealisedPnl: 0,
      sevenProfit: 0,
      sevenProfitRate: 0,
      lastTradeTime: p.lastTradeTime ? Math.floor(p.lastTradeTime / 1000) : 0,
    },
  }
}

/** Map Binance ms-timestamp equity points into Gateio seconds-timestamp points. */
function adaptBinanceEquity(points: BinanceEquityPoint[]): GateioEquityPoint[] {
  return points.map((e) => ({
    profit: e.pnl ?? 0,
    profitRate: e.roi ?? 0,
    currentProfit: e.pnl ?? 0,
    totalInvest: 0,
    liqTag: false,
    resetTag: false,
    timestamp: Math.floor(e.timestamp / 1000),
  }))
}

/** Map Binance asset-share rows into Gateio concentration rows (percent kept 0..1). */
function adaptBinanceMarkets(rows: BinanceMarketConcentration[]): GateioMarketConcentration[] {
  return rows.map((m) => ({
    symbol: m.symbol,
    // Binance's coin endpoint reports the share as a raw percentage; normalize defensively.
    percent: m.volume > 1 ? Math.min(m.volume / 100, 1) : Math.max(0, Math.min(m.volume, 1)),
    count: 0,
    pnl: 0,
  }))
}

/** Map open Binance positions into concentration rows, weighting by absolute PnL share. */
function adaptBinancePositions(pos: BinancePosition[]): GateioMarketConcentration[] {
  const total = pos.reduce((sum, p) => sum + Math.abs(p.pnl ?? 0), 0)
  return pos.map((p) => ({
    symbol: p.symbol,
    percent: total > 0 ? Math.min(Math.abs(p.pnl ?? 0) / total, 1) : 1 / Math.max(pos.length, 1),
    count: 0,
    pnl: p.pnl ?? 0,
  }))
}

/** Map OKX ms-timestamp cumulative-yield points into Gateio-shaped equity points (ratio, not USD). */
function adaptOkxEquity(points: Array<{ statTime: number; ratio: number }>): GateioEquityPoint[] {
  return points.map((p) => ({
    profit: p.ratio ?? 0,
    profitRate: p.ratio ?? 0,
    currentProfit: p.ratio ?? 0,
    totalInvest: 0,
    liqTag: false,
    resetTag: false,
    timestamp: Math.floor((p.statTime ?? 0) / 1000),
  }))
}

/** Map Bitget klineProfit points ({ amount, dataTime-ms }) into Gateio-shaped equity points (USD amount). */
function adaptBitgetEquity(points: Array<{ amount: number; dataTime: number | null }>): GateioEquityPoint[] {
  return points.map((p) => ({
    profit: p.amount ?? 0,
    profitRate: 0,
    currentProfit: p.amount ?? 0,
    totalInvest: 0,
    liqTag: false,
    resetTag: false,
    timestamp: p.dataTime ? Math.floor(p.dataTime / 1000) : 0,
  }))
}

function okxNum(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = parseFloat(v)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function okxStr(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/**
 * Best-effort adapter for OKX position rows (raw upstream `positionList`, whose
 * shape varies). Rows are weighted by their reported share normalized to 0..1;
 * rows without a share field split the remaining weight equally.
 */
function adaptOkxPositions(positions: unknown[] | undefined): GateioMarketConcentration[] {
  if (!Array.isArray(positions) || positions.length === 0) return []
  const rows = positions.map((p) => {
    const rec = (p ?? {}) as Record<string, unknown>
    const symbol = okxStr(rec.instId) || okxStr(rec.symbol) || okxStr(rec.ccy) || '?'
    const raw = okxNum(rec.percent) || okxNum(rec.marginPercent) || 0
    // Upstream shares may be raw percentages; normalize defensively to 0..1.
    const percent = raw > 1 ? Math.min(raw / 100, 1) : Math.max(0, Math.min(raw, 1))
    return { symbol, percent, count: 0, pnl: 0 }
  })
  const withShare = rows.filter((r) => r.percent > 0)
  const noShare = rows.filter((r) => r.percent <= 0)
  if (noShare.length > 0) {
    const remaining = Math.max(0, 1 - withShare.reduce((sum, r) => sum + r.percent, 0))
    const each = remaining / noShare.length
    for (const r of noShare) r.percent = each
  }
  return rows
}

export default function LeaderPerformancePage() {
  // `useSearchParams` must sit under a Suspense boundary for static prerendering.
  return (
    <Suspense
      fallback={
        <NexusLayout>
          <Panel title="Leader" subtitle="Loading profile…" liveStatus="stale">
            <div className="py-6 text-sm text-text-muted">Loading…</div>
          </Panel>
        </NexusLayout>
      }
    >
      <LeaderPerformanceInner />
    </Suspense>
  )
}

function LeaderPerformanceInner() {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const id = params?.id ?? ''

  const platform = parsePlatform(searchParams?.get('platform'))
  const isOkx = platform === 'okx'
  const isBinance = platform === 'binance'
  const hasPerformanceModule = PLATFORMS_WITH_PERFORMANCE.includes(platform)
  const platformName = platformLabel(platform)

  const [data, setData] = useState<GateioPerformanceData>(EMPTY)
  const [positions, setPositions] = useState<GateioMarketConcentration[]>([])
  const [leader, setLeader] = useState<CopyTradingLeader | null>(null)
  const [okxLeader, setOkxLeader] = useState<OkxLeaderDetail | null>(null)
  const [degraded, setDegraded] = useState(false)
  const [status, setStatus] = useState<'live' | 'stale' | 'error'>('stale')

  const fetchData = useCallback(async () => {
    try {
      if (hasPerformanceModule) {
        // Full per-leader performance intelligence for registered platforms.
        const res = await fetch(`/api/v1/copy-trading/performance?leader_id=${id}&platform=${platform}`)
        const d = await res.json()
        if (d.data) {
          if (isBinance) {
            setData({
              profile: adaptBinanceProfile(d.data.profile ?? null),
              equity: adaptBinanceEquity(d.data.equity ?? []),
              markets: adaptBinanceMarkets(d.data.markets ?? []),
              trades: [], // Binance lead-portfolio API exposes no closed trades.
            })
            setPositions(adaptBinancePositions(d.data.positions ?? []))
          } else {
            setData({
              profile: d.data.profile ?? null,
              equity: d.data.equity ?? [],
              markets: d.data.markets ?? [],
              trades: d.data.trades ?? [],
            })
            setPositions([])
          }
          setDegraded(Boolean(d.data.degraded))
          setStatus('live')
        } else {
          setStatus('error')
        }
      } else if (isOkx) {
        // OKX's leaderboard caps page size at 20, so searching the fetched list
        // would miss leaders ranked deeper. Use the server per-leader lookup,
        // which paginates every page server-side.
        const res = await fetch(`/api/v1/copy-trading/leader?platform=okx&leader_id=${encodeURIComponent(id)}&cycle=month`)
        const d = await res.json()
        if (d.data) {
          setOkxLeader(d.data.leader ?? null)
          setDegraded(Boolean(d.data.degraded))
          setStatus('live')
        } else {
          setStatus('error')
        }
      } else {
        // No performance module — use the server per-leader lookup, which
        // paginates the FULL leaderboard server-side so deep ranks resolve
        // (page-1 search would miss leaders ranked >100).
        const res = await fetch(
          `/api/v1/copy-trading/leader?platform=${platform}&leader_id=${encodeURIComponent(id)}&cycle=month`,
        )
        const d = await res.json()
        if (d.data) {
          setLeader(d.data.leader ?? null)
          setDegraded(Boolean(d.data.degraded))
          setStatus('live')
        } else {
          setStatus('error')
        }
      }
    } catch {
      setStatus('error')
    }
  }, [id, platform, isBinance, isOkx, hasPerformanceModule])

  useEffect(() => {
    if (!id) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData()
    const timer = setInterval(fetchData, 15_000)
    return () => clearInterval(timer)
  }, [id, fetchData])

  const profile = data.profile
  const stats = profile?.stats

  const columns: Column<GateioTrade>[] = [
    { key: 'market', header: 'Market', render: (r) => <span className="font-mono text-text-primary">{r.market}</span> },
    {
      key: 'profit',
      header: 'Profit',
      align: 'right',
      render: (r) => (
        <span className={`font-mono ${r.profit >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
          {r.profit >= 0 ? '+' : ''}
          {fmtUsd(r.profit)}
        </span>
      ),
    },
    { key: 'hold', header: 'Hold', align: 'right', render: (r) => <span className="text-text-muted">{fmtHold(r.holdSeconds)}</span> },
    { key: 'time', header: 'Closed', align: 'right', render: (r) => <span className="text-xs text-text-muted">{fmtTime(r.timestamp)}</span> },
  ]

  const panelTitle = hasPerformanceModule
    ? profile?.nickname || `Leader ${id}`
    : isOkx
      ? okxLeader?.nick || okxLeader?.id || `Leader ${id}`
      : leader?.nick || leader?.id || `Leader ${id}`

  /** OKX labels hold [tierName, ...instIds]; drop the tier slot when it exists. */
  const okxInstruments = isOkx && okxLeader ? (okxLeader.tier ? okxLeader.labels.slice(1) : okxLeader.labels) : []

  // Deep-lookup results are Bitget/Hyperliquid-shaped extensions of the shared
  // leader type — cast only at the render boundary (client mirror types).
  const bitgetLeader = platform === 'bitget' ? (leader as BitgetLeaderDetail | null) : null
  const hlLeader = platform === 'hyperliquid' ? (leader as HyperliquidLeaderDetail | null) : null

  return (
    <NexusLayout>
      <Panel
        title={panelTitle}
        subtitle={`${platformName} copy-trading ${hasPerformanceModule ? 'performance intelligence' : 'leader profile'}`}
        liveStatus={status}
        onRefresh={fetchData}
        actions={
          degraded
            ? [<span key="degraded" className="rounded bg-accent-amber/20 px-2 py-0.5 text-xs text-accent-amber">degraded</span>]
            : undefined
        }
      >
        {hasPerformanceModule ? (
          profile ? (
            <ProfileHeader profile={profile} />
          ) : (
            <div className="py-6 text-sm text-text-muted">Profile unavailable</div>
          )
        ) : isOkx ? (
          okxLeader ? (
            <LeaderRowHeader leader={okxLeader} tier={okxLeader.tier} />
          ) : degraded ? (
            <div className="py-6 text-sm text-text-muted">Leader data is temporarily unavailable.</div>
          ) : (
            <div className="py-6 text-sm text-text-muted">Leader {id} not found on the {platformName} copy-trading leaderboard.</div>
          )
        ) : leader ? (
          <LeaderRowHeader leader={leader} />
        ) : (
          <div className="py-6 text-sm text-text-muted">
            Leader {id} not found on the {platformName} copy-trading leaderboard.
          </div>
        )}
      </Panel>

      {hasPerformanceModule ? (
        <>
          {isBinance ? (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard label="Total Profit" value={stats ? fmtUsd(stats.profit) : '—'} />
                <StatCard label="ROI" value={stats ? fmtPct(stats.profitRate, 2) : '—'} />
                <StatCard label="Sharpe" value={stats && stats.sharpRatio > 0 ? stats.sharpRatio.toFixed(2) : '—'} />
                <StatCard label="AUM" value={stats && stats.aum > 0 ? fmtUsd(stats.aum) : '—'} />
                <StatCard label="Margin Balance" value={stats && stats.totalInvest > 0 ? fmtUsd(stats.totalInvest) : '—'} />
                <StatCard label="Followers" value={stats ? `${stats.currFollowNum} / ${stats.maxFollowNum}` : '—'} />
                <StatCard label="Trade Count" value={stats ? String(stats.tradeNum) : '—'} />
                <StatCard label="Profit Sharing" value={profile && profile.feeRate > 0 ? fmtPct(profile.feeRate, 0) : '—'} />
              </div>
              <p className="text-xs text-text-muted">
                Binance doesn&apos;t expose win rate, max drawdown, or follow profit in its lead-portfolio endpoints — those
                metrics are omitted rather than shown as 0.
              </p>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Total Profit" value={stats ? fmtUsd(stats.profit) : '—'} />
              <StatCard label="Profit Rate" value={stats ? fmtPct(stats.profitRate, 2) : '—'} />
              <StatCard label="Win Rate" value={stats ? fmtPct(stats.winRate, 2) : '—'} />
              <StatCard label="Max Drawdown" value={stats ? fmtPct(stats.maxDrawdown, 2) : '—'} />
              <StatCard label="Sharpe" value={stats ? stats.sharpRatio.toFixed(2) : '—'} />
              <StatCard label="AUM" value={stats ? fmtUsd(stats.aum) : '—'} />
              <StatCard label="Follow Profit" value={stats ? fmtUsd(stats.followProfit) : '—'} />
              <StatCard label="Followers" value={stats ? `${stats.currFollowNum} / ${stats.maxFollowNum}` : '—'} />
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Panel title="Profit Curve" subtitle="Monthly cumulative profit" className="lg:col-span-2">
              <EquityCurve points={data.equity} />
            </Panel>
            <Panel title="Position Concentration" subtitle="Share of total investment">
              <Concentration rows={positions.length > 0 ? positions : data.markets} />
            </Panel>
          </div>

          {!isBinance && profile && profile.markets.length > 0 && (
            <Panel title="Tradable Markets" subtitle={`Top ${profile.markets.length} instruments`}>
              <div className="flex flex-wrap gap-2">
                {profile.markets.map((m) => (
                  <span key={m.symbol} className="rounded border border-bg-border px-2 py-1 font-mono text-xs text-text-primary">
                    {m.symbol} <span className="text-text-muted">{m.maxLeverage}x</span>
                  </span>
                ))}
              </div>
            </Panel>
          )}

          <Panel
            title="Recent Trades"
            subtitle="Latest closed copy-trading positions"
            liveStatus={status}
            onRefresh={fetchData}
          >
            {isBinance ? (
              <div className="py-10 text-center text-sm text-text-muted">
                Closed trade history is not available for Binance lead portfolios.
              </div>
            ) : data.trades.length === 0 ? (
              <div className="py-10 text-center text-sm text-text-muted">No recent trades</div>
            ) : (
              <DataTable columns={columns} data={data.trades} maxHeight={420} />
            )}
          </Panel>
        </>
      ) : isOkx ? (
        okxLeader ? (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Total Profit" value={fmtUsd(okxLeader.profit)} />
              <StatCard label="Profit Rate" value={fmtPct(okxLeader.profitRate, 2)} />
              <StatCard label="Win Rate" value={fmtPct(okxLeader.winRate, 2)} />
              <StatCard label="Max Drawdown" value={fmtPct(okxLeader.maxDrawdown, 2)} />
              <StatCard label="Sharpe" value={okxLeader.sharpe ? okxLeader.sharpe.toFixed(2) : '—'} />
              <StatCard label="AUM" value={okxLeader.aum > 0 ? fmtUsd(okxLeader.aum) : '—'} />
              <StatCard label="Followers" value={okxLeader.followers ? String(okxLeader.followers) : '—'} />
              <StatCard label="Leading Days" value={okxLeader.leadingDays ? String(okxLeader.leadingDays) : '—'} />
              <StatCard label="Tier" value={okxLeader.tier ?? '—'} />
              <StatCard label="Leverage" value={okxLeader.lever > 0 ? `${okxLeader.lever}x` : '—'} />
              <StatCard label="Profit Sharing" value={okxLeader.profitShare > 0 ? fmtPct(okxLeader.profitShare, 0) : '—'} />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Panel title="Profit Curve" subtitle="Cumulative yield (90-day window)" className="lg:col-span-2">
                <EquityCurve points={adaptOkxEquity(okxLeader.equityCurve)} valueKind="ratio" />
              </Panel>
              <Panel title="Position Concentration" subtitle="Open positions by share">
                <Concentration rows={adaptOkxPositions(okxLeader.positions)} />
              </Panel>
            </div>

            {okxInstruments.length > 0 && (
              <Panel title="Traded Instruments" subtitle={`${okxInstruments.length} instruments from the leader card`}>
                <div className="flex flex-wrap gap-2">
                  {okxInstruments.map((sym) => (
                    <span key={sym} className="rounded border border-bg-border px-2 py-1 font-mono text-xs text-text-primary">
                      {sym}
                    </span>
                  ))}
                </div>
              </Panel>
            )}

            <Panel title="Recent Trades" subtitle="Latest closed copy-trading positions">
              <div className="py-10 text-center text-sm text-text-muted">
                Closed trade history is not exposed by the OKX follow-rank API.
              </div>
            </Panel>
          </>
        ) : degraded ? (
          <div className="py-10 text-center text-sm text-text-muted">Leader data is temporarily unavailable.</div>
        ) : (
          <div className="py-10 text-center text-sm text-text-muted">
            Leader {id} not found on the {platformName} copy-trading leaderboard.
          </div>
        )
      ) : platform === 'bitget' && leader ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Total Profit" value={fmtUsd(leader.profit)} />
            <StatCard label="Profit Rate" value={fmtPct(leader.profitRate, 2)} />
            <StatCard label="Win Rate" value={fmtPct(leader.winRate, 2)} />
            <StatCard label="Max Drawdown" value={fmtPct(leader.maxDrawdown, 2)} />
            <StatCard
              label="Copier Profit"
              value={bitgetLeader?.copierProfit != null && bitgetLeader.copierProfit > 0 ? fmtUsd(bitgetLeader.copierProfit) : '—'}
            />
            <StatCard label="Score" value={bitgetLeader?.score != null && bitgetLeader.score > 0 ? bitgetLeader.score.toFixed(2) : '—'} />
            <StatCard label="AUM" value={leader.aum > 0 ? fmtUsd(leader.aum) : '—'} />
            <StatCard label="Followers" value={leader.followers ? String(leader.followers) : '—'} />
            <StatCard label="Portfolio ID" value={bitgetLeader?.portfolioId ?? '—'} />
            <StatCard label="Leading Days" value={leader.leadingDays ? String(leader.leadingDays) : '—'} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Panel title="Profit Curve" subtitle="klineProfit cumulative amount (30 points)" className="lg:col-span-2">
              <EquityCurve points={adaptBitgetEquity(bitgetLeader?.equityCurve ?? [])} />
            </Panel>
            {bitgetLeader?.portfolioId && (
              <Panel title="Portfolio" subtitle="Copy-trading portfolio id">
                <div className="py-4 font-mono text-sm text-text-primary">{bitgetLeader.portfolioId}</div>
              </Panel>
            )}
          </div>

          <Panel title="Recent Trades" subtitle="Latest closed copy-trading positions">
            <div className="py-10 text-center text-sm text-text-muted">
              Performance intelligence (positions, trades) not yet available for {platformName}. Showing leaderboard
              metrics only.
            </div>
          </Panel>
        </>
      ) : platform === 'hyperliquid' && leader ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Account Value" value={leader.aum > 0 ? fmtUsd(leader.aum) : '—'} />
            <StatCard label="Win Rate" value="—" />
            <StatCard label="Max Drawdown" value="—" />
            <StatCard label="Sharpe" value="—" />
            <StatCard label="Followers" value="—" />
            <StatCard label="Leading Days" value="—" />
          </div>

          <Panel title="Window Performance" subtitle="PnL · ROI · Volume by period (from the stats-data dump)">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-bg-border text-left text-xs text-text-muted">
                    <th className="py-2 pr-4 font-medium">Metric</th>
                    {HL_WINDOWS.map((w) => (
                      <th key={w.key} className="py-2 pr-4 font-medium">
                        {w.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {HL_ROWS.map((row) => (
                    <tr key={row.label} className="border-b border-bg-border">
                      <td className="py-2 pr-4 text-text-muted">{row.label}</td>
                      {HL_WINDOWS.map((w) => {
                        const perf = hlLeader?.windowPerformances?.find((p) => p.window === w.key)
                        const value = perf ? row.value(perf) : null
                        return (
                          <td key={w.key} className="py-2 pr-4 font-mono text-text-primary">
                            {value === null ? '—' : value}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Recent Trades" subtitle="Latest closed copy-trading positions">
            <div className="py-10 text-center text-sm text-text-muted">
              Performance intelligence (positions, trades) not yet available for {platformName}. Showing leaderboard
              metrics only.
            </div>
          </Panel>
        </>
      ) : leader ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Total Profit" value={fmtUsd(leader.profit)} />
            <StatCard label="Profit Rate" value={fmtPct(leader.profitRate, 2)} />
            <StatCard label="Win Rate" value={fmtPct(leader.winRate, 2)} />
            <StatCard label="Max Drawdown" value={fmtPct(leader.maxDrawdown, 2)} />
            <StatCard label="Sharpe" value={leader.sharpe ? leader.sharpe.toFixed(2) : '—'} />
            <StatCard label="AUM" value={leader.aum > 0 ? fmtUsd(leader.aum) : '—'} />
            <StatCard label="Followers" value={leader.followers ? String(leader.followers) : '—'} />
            <StatCard label="Leading Days" value={leader.leadingDays ? String(leader.leadingDays) : '—'} />
          </div>

          <Panel title="Performance Intelligence" subtitle={`Profit curve · positions · trades`}>
            <div className="py-10 text-center text-sm text-text-muted">
              Performance intelligence (profit curve, positions, trades) not yet available for {platformName}.
              Showing leaderboard metrics only.
            </div>
          </Panel>

          <Panel title="Recent Trades" subtitle="Latest closed copy-trading positions">
            <div className="py-10 text-center text-sm text-text-muted">
              Performance intelligence (profit curve, positions, trades) not yet available for {platformName}.
              Showing leaderboard metrics only.
            </div>
          </Panel>
        </>
      ) : null}
    </NexusLayout>
  )
}
