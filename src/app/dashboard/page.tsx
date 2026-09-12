"use client"
import { LiveTerminalFeed } from '@/components/features/LiveTerminalFeed'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { PriceTag } from '@/components/primitives/PriceTag'
import { DeltaBadge } from '@/components/primitives/DeltaBadge'
import { LiveDot } from '@/components/primitives/LiveDot'

// ── Intelligence hubs ──
// The dashboard is the entry point to every deep-dive surface, so the jump-off
// grid is data rather than hand-written JSX: one map() renders it, and a route
// added here can never drift out of sync with its label.
const HUB_GROUPS: Array<{ title: string; links: Array<{ label: string; href: string }> }> = [
  {
    title: 'Market Structure',
    links: [
      { label: 'Market Score', href: '/market-score' },
      { label: 'Screener', href: '/screener' },
      { label: 'Order Book', href: '/orderbook' },
      { label: 'Trending', href: '/trending' },
      { label: 'Conviction Board', href: '/intelligence/leaderboard' },
      { label: 'Market Overview', href: '/market' },
    ],
  },
  {
    title: 'On-Chain',
    links: [
      { label: 'Entity Intel', href: '/entities' },
      { label: 'Whale Clusters', href: '/whale-cluster' },
      { label: 'Knowledge Graph', href: '/graph' },
      { label: 'Exchange Flow', href: '/exchange-flow' },
      { label: 'DEX Monitor', href: '/dex' },
      { label: 'RugCheck', href: '/rugcheck' },
    ],
  },
  {
    title: 'Tokens',
    links: [
      { label: 'Token Intel', href: '/tokens' },
      { label: 'Discover', href: '/tokens/discover' },
      { label: 'Degen Scanner', href: '/scanner' },
      { label: 'Compare Tokens', href: '/compare/tokens' },
      { label: 'Rug Audit', href: '/meme/risk' },
      { label: 'Launch Alpha', href: '/meme/launch-alpha' },
    ],
  },
  {
    title: 'DeFi',
    links: [
      { label: 'Yield Farming', href: '/yields' },
      { label: 'Yield Finder', href: '/defi/yields' },
      { label: 'TVL Dashboard', href: '/defi/tvl' },
      { label: 'Protocol Revenue', href: '/revenue' },
      { label: 'Stablecoins', href: '/stablecoins' },
      { label: 'Sectors', href: '/sectors' },
    ],
  },
  {
    title: 'Macro',
    links: [
      { label: 'Macro Command', href: '/macro' },
      { label: 'Global Macro', href: '/global-macro' },
      { label: 'Calendar', href: '/calendar' },
      { label: 'Forex', href: '/forex' },
      { label: 'Indonesia', href: '/indonesia-macro' },
      { label: 'Feeds', href: '/feeds' },
    ],
  },
  {
    title: 'TradFi & Forecasts',
    links: [
      { label: 'Fundamentals', href: '/fundamentals' },
      { label: 'Financials', href: '/financials' },
      { label: 'Prediction Markets', href: '/prediction-markets' },
      { label: 'Paper Trading', href: '/predictions/paper' },
      { label: 'Trade Tape', href: '/predictions/tape' },
      { label: 'Forecast Board', href: '/predictions/leaderboard' },
    ],
  },
]

// ── Market regime (fear-greed composite) ──
interface Regime {
  score: number
  label: string
  change: number
  state: string
  stance: string
  btcDom: number
  totalMcap: number
  mcapChange24h: number
}

// ── Cross-asset tickers ──
interface Ticker {
  symbol: string
  price: string
  change: string
  positive: boolean
}

// ── Unified intelligence score ──
interface IntelComponent {
  score: number
  signals: unknown[]
}

interface IntelSignal {
  id: string
  name: string
  description: string
  direction: string
  strength: number
  timestamp: string
}

interface IntelScore {
  overall: number
  grade: string
  regime: string
  components: Record<string, IntelComponent>
  compositeSignals: IntelSignal[]
  timestamp: string
}

// ── Per-symbol conviction ──
interface SymbolScore {
  symbol: string
  market: string
  compositeScore: number
  direction: string
  confidence: number
}

// ── IDX alpha ideas ──
interface IdxIdea {
  code: string
  name: string
  sector: string
  close: number
  changePct: number
  per: number | null
  pbv: number | null
  roe: number | null
  der: number | null
  dividendYield: number | null
  foreignNetStreakDays: number
  foreignNetStreakDir: string | null
  valueScore: number
  accumulationScore: number
  combinedScore: number
  alphaScore: number
  alphaVerdict: string
  alphaReasons: string[]
}

interface NewsItem {
  id: string
  title: string
  url: string
  sourceId: string
  publishedAt: string
  category: string
  [key: string]: unknown
}

interface DexTrending {
  name: string
  priceUsd: number
  fdv: number
  volume24h: number
  priceChange24h: number
  [key: string]: unknown
}

interface WhaleMove {
  id: string
  amount: number
  symbol: string
  usd: number
  from: string
  to: string
  link?: string
  [key: string]: unknown
}

interface ActivityEvent {
  id: string
  type: string
  headline: string
  asset: string
  direction: string
  strength: number
  timestamp: string
  [key: string]: unknown
}

interface AlphaSignalCard {
  id: string
  type: string
  asset: string
  strength: number
  confidence: number
  headline: string
  explanation: string
  source: string
  timestamp: string
}

interface ThesisCard {
  symbol: string
  thesis: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  confidence: number
  totalSignals: number
}

interface TrendingCard {
  id: string
  title: string
  source: string
}

interface MemeToken {
  id: string
  symbol: string
  name: string
  platform: string
  chain: string
  price: number
  change24h: number
  volume24h: number
  marketCap: number
  holders: number
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0'
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

/** Composite score → colour band, shared by every conviction surface. */
function scoreColor(score: number): string {
  if (score >= 70) return 'text-data-bull'
  if (score >= 55) return 'text-teal-vivid'
  if (score >= 40) return 'text-data-warn'
  return 'text-data-bear'
}

function directionGlyph(direction: string): string {
  if (direction === 'bullish') return '🟢'
  if (direction === 'bearish') return '🔴'
  return '⚪'
}

/** Greed/fear composite → regime accent. */
function regimeAccent(score: number): string {
  if (score >= 75) return 'border-data-bull/40 bg-data-bull/5'
  if (score >= 55) return 'border-teal-vivid/40 bg-teal-vivid/5'
  if (score >= 45) return 'border-data-warn/40 bg-data-warn/5'
  return 'border-data-bear/40 bg-data-bear/5'
}

export default function DashboardPage() {
  const [regime, setRegime] = useState<Regime | null>(null)
  const [tickers, setTickers] = useState<Ticker[]>([])
  const [intel, setIntel] = useState<IntelScore | null>(null)
  const [symbolScores, setSymbolScores] = useState<SymbolScore[]>([])
  const [idxIdeas, setIdxIdeas] = useState<IdxIdea[]>([])
  const [idxTradeDate, setIdxTradeDate] = useState('')
  const [meme, setMeme] = useState<MemeToken[]>([])
  const [news, setNews] = useState<NewsItem[]>([])
  const [dex, setDex] = useState<DexTrending[]>([])
  const [whaleMoves, setWhaleMoves] = useState<WhaleMove[]>([])
  const [activity, setActivity] = useState<ActivityEvent[]>([])
  const [alphaSignals, setAlphaSignals] = useState<AlphaSignalCard[]>([])
  const [thesis, setThesis] = useState<ThesisCard | null>(null)
  const [trending, setTrending] = useState<TrendingCard[]>([])
  const [status, setStatus] = useState<'live' | 'stale' | 'error'>('live')
  const [lastUpdated, setLastUpdated] = useState('')

  // One refresh path for the whole board — every panel shares a single
  // failure-tolerant fan-out instead of competing polling loops.
  const fetchAll = useCallback(async () => {
    const results = await Promise.allSettled([
      fetch('/api/v1/fear-greed').then(r => r.json()),
      fetch('/api/v1/market/prices').then(r => r.json()),
      fetch('/api/v1/intelligence-score').then(r => r.json()),
      fetch('/api/v1/market-score').then(r => r.json()),
      fetch('/api/v1/saham/watchlist-ideas?limit=8').then(r => r.json()),
      fetch('/api/v1/meme/leaderboard').then(r => r.json()),
      fetch('/api/v1/news?category=crypto&limit=12').then(r => r.json()),
      fetch('/api/v1/dex/trending?network=solana').then(r => r.json()),
      fetch('/api/v1/whale-alert').then(r => r.json()),
      fetch('/api/v1/alpha-feed?limit=6').then(r => r.json()),
      fetch('/api/v1/token/thesis?symbol=BTC').then(r => r.json()),
      fetch('/api/v1/feed?limit=3').then(r => r.json()),
    ])

    const val = <T,>(i: number): T | null =>
      results[i].status === 'fulfilled' ? (results[i] as PromiseFulfilledResult<T>).value : null

    // Market regime
    const fg = val<{ data?: { composite?: Record<string, number & string>; regime?: Record<string, string>; headerMetrics?: Record<string, number> } }>(0)
    const comp = fg?.data?.composite
    const hm = fg?.data?.headerMetrics
    if (comp) {
      setRegime({
        score: Number(comp.score ?? 0),
        label: String(comp.label ?? 'Neutral'),
        change: Number(comp.change ?? 0),
        state: String(fg?.data?.regime?.state ?? '—'),
        stance: String(fg?.data?.regime?.stance ?? '—'),
        btcDom: Number(hm?.btcDom ?? 0),
        totalMcap: Number(hm?.totalMcap ?? 0),
        mcapChange24h: Number(hm?.mcapChange24h ?? 0),
      })
    }

    // Cross-asset tickers
    const prices = val<{ data?: { tickers?: Ticker[] } }>(1)
    if (Array.isArray(prices?.data?.tickers)) setTickers(prices.data.tickers)

    // Unified intelligence score
    const is = val<{ data?: IntelScore }>(2)
    if (is?.data) setIntel(is.data)

    // Per-symbol conviction
    const ms = val<{ data?: { scores?: SymbolScore[] } }>(3)
    if (Array.isArray(ms?.data?.scores)) {
      setSymbolScores([...ms.data.scores].sort((a, b) => b.compositeScore - a.compositeScore).slice(0, 12))
    }

    // IDX alpha ideas
    const idx = val<{ data?: { ideas?: IdxIdea[]; tradeDate?: string } }>(4)
    if (Array.isArray(idx?.data?.ideas)) {
      setIdxIdeas(idx.data.ideas)
      setIdxTradeDate(String(idx.data.tradeDate ?? ''))
    }

    // Meme alpha — surface only priced tokens with real volume.
    const mem = val<{ tokens?: MemeToken[] }>(5)
    if (Array.isArray(mem?.tokens)) {
      setMeme(
        mem.tokens
          .filter(t => Number(t.volume24h) > 0)
          .sort((a, b) => Number(b.volume24h) - Number(a.volume24h))
          .slice(0, 12),
      )
    }

    const nw = val<{ data?: { items?: Record<string, unknown>[] } }>(6)
    if (Array.isArray(nw?.data?.items)) {
      setNews(nw.data.items.slice(0, 12).map(n => ({
        id: String(n.id ?? ''),
        title: String(n.title ?? ''),
        url: String(n.url ?? ''),
        sourceId: String(n.sourceId ?? ''),
        publishedAt: String(n.publishedAt ?? ''),
        category: String(n.category ?? ''),
      })))
    }

    const dx = val<{ data?: { items?: Record<string, unknown>[] } }>(7)
    if (Array.isArray(dx?.data?.items)) {
      setDex(dx.data.items.slice(0, 10).map(d => ({
        name: String(d.symbol ?? d.name ?? ''),
        priceUsd: Number(d.priceUsd ?? 0),
        fdv: Number(d.fdv ?? 0),
        volume24h: Number(d.volume24h ?? 0),
        priceChange24h: Number(d.priceChange24h ?? 0),
      })))
    }

    const wh = val<{ data?: { items?: Record<string, unknown>[] } }>(8)
    if (Array.isArray(wh?.data?.items)) {
      setWhaleMoves(wh.data.items.slice(0, 10).map(w => ({
        id: String(w.id ?? ''),
        amount: Number(w.amount ?? 0),
        symbol: String(w.symbol ?? ''),
        usd: Number(w.usd ?? 0),
        from: String(w.from ?? ''),
        to: String(w.to ?? ''),
        link: w.link ? String(w.link) : undefined,
      })))
    }

    // Derived alpha signals (premium — stays empty for anonymous visitors)
    const af = val<{ data?: Record<string, unknown>[] }>(9)
    if (Array.isArray(af?.data)) {
      const mapped = af.data.slice(0, 6).map(s => ({
        id: String(s.id ?? ''),
        type: String(s.type ?? 'signal'),
        asset: String(s.asset ?? ''),
        strength: Number(s.strength ?? 0),
        confidence: Number(s.confidence ?? 0),
        headline: String(s.headline ?? ''),
        explanation: String(s.explanation ?? ''),
        source: String(s.source ?? ''),
        timestamp: s.timestamp ? new Date(String(s.timestamp)).toLocaleTimeString() : '',
      }))
      setAlphaSignals(mapped)
      setActivity(mapped.map(s => ({
        id: s.id, type: s.type, headline: s.headline, asset: s.asset,
        direction: String(af.data!.find(x => String(x.id ?? '') === s.id)?.direction ?? 'neutral'),
        strength: s.strength, timestamp: s.timestamp,
      })))
    }

    const th = val<Record<string, unknown>>(10)
    if (th?.thesis) {
      const dir = th.thesis === 'BULLISH' || th.thesis === 'BEARISH' ? th.thesis : 'NEUTRAL'
      setThesis({
        symbol: String(th.symbol ?? 'BTC'),
        thesis: dir as 'BULLISH' | 'BEARISH' | 'NEUTRAL',
        confidence: Number(th.confidence ?? 0),
        totalSignals: Number(th.totalSignals ?? 0),
      })
    }

    const fd = val<{ top?: Record<string, unknown>[] }>(11)
    if (Array.isArray(fd?.top)) {
      setTrending(fd.top.slice(0, 3).map(i => ({
        id: String(i.id ?? ''),
        title: String(i.t ?? ''),
        source: String(i.s ?? ''),
      })))
    }

    // "live" as long as the core market reads landed.
    const coreOk = results[0].status === 'fulfilled' || results[1].status === 'fulfilled'
    setStatus(coreOk ? 'live' : 'error')
    setLastUpdated(new Date().toLocaleTimeString())
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAll()
    const interval = setInterval(fetchAll, 30_000)
    return () => clearInterval(interval)
  }, [fetchAll])

  const newsColumns: Column<NewsItem>[] = [
    { key: 'title', header: 'Headline', width: 300, render: r => (
      <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-xs text-text-primary hover:text-teal-vivid truncate block">
        {r.title}
      </a>
    )},
    { key: 'category', header: 'Cat', width: 80, render: r => <span className="text-xs text-text-muted font-mono">{r.category}</span> },
    { key: 'sourceId', header: 'Source', width: 100, align: 'right', render: r => <span className="text-xs text-text-muted font-mono uppercase">{r.sourceId}</span> },
  ]

  const dexColumns: Column<DexTrending>[] = [
    { key: 'name', header: 'Pair', width: 130, render: r => <span className="text-teal-vivid font-bold text-xs truncate">{r.name}</span> },
    { key: 'priceUsd', header: 'Price', width: 80, align: 'right', render: r => <PriceTag value={r.priceUsd} size="sm" /> },
    { key: 'priceChange24h', header: '24h', width: 60, align: 'right', render: r => <DeltaBadge value={r.priceChange24h} size="xs" /> },
    { key: 'volume24h', header: 'Vol(24h)', width: 80, align: 'right', render: r => <span className="text-text-secondary font-mono text-xs">{fmtUsd(r.volume24h)}</span> },
  ]

  const whaleColumns: Column<WhaleMove>[] = [
    { key: 'from', header: 'Flow', width: 230, render: r => (
      <div className="flex items-center space-x-1 truncate">
        <span className="text-text-primary text-xs truncate max-w-[100px]">{r.from}</span>
        <span className="text-text-muted text-xs">→</span>
        <span className="text-text-primary text-xs truncate max-w-[100px]">{r.to}</span>
        {r.link && (
          <a href={r.link} target="_blank" rel="noopener noreferrer" className="ml-1 text-teal-vivid hover:underline">↗</a>
        )}
      </div>
    )},
    { key: 'amount', header: 'Amount', width: 100, align: 'right', render: r => (
      <span className="text-teal-vivid font-bold tabular-nums text-xs">
        {r.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })} <span className="text-xs text-text-muted">{r.symbol}</span>
      </span>
    )},
    { key: 'usd', header: 'USD', width: 80, align: 'right', render: r => <PriceTag value={r.usd} size="sm" /> },
  ]

  const activityColumns: Column<ActivityEvent>[] = [
    { key: 'headline', header: 'Signal', width: 250, render: r => (
      <span className="text-text-primary text-xs truncate block">{r.headline}</span>
    )},
    { key: 'asset', header: 'Asset', width: 70, render: r => (
      <span className="text-teal-vivid font-mono text-xs">{r.asset}</span>
    )},
    { key: 'direction', header: 'Dir', width: 40, render: r => <span className="text-xs">{directionGlyph(r.direction)}</span> },
  ]

  const intelComponents = intel ? Object.entries(intel.components) : []

  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        {/* ── Market regime — the single cross-asset read ── */}
        <div className={`border ${regime ? regimeAccent(regime.score) : 'border-bg-border bg-bg-panel'} px-3 py-2`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <LiveDot status={status} size={6} />
              <span className="text-[11px] font-mono uppercase tracking-wide text-text-muted">Market Regime</span>
            </div>
            <span className="text-[10px] font-mono text-text-muted">
              {lastUpdated && `updated ${lastUpdated}`}
            </span>
          </div>

          <div className="mt-2 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div>
              <div className="text-[10px] font-mono uppercase text-text-muted">Fear / Greed</div>
              <div className="flex items-baseline gap-2">
                <span className={`text-[22px] font-head font-bold tabular-nums ${regime ? scoreColor(regime.score) : 'text-text-muted'}`}>
                  {regime ? regime.score : '—'}
                </span>
                {regime && <span className="text-[11px] font-mono text-text-secondary">{regime.label}</span>}
              </div>
              {regime && regime.change !== 0 && (
                <div className={`text-[10px] font-mono ${regime.change > 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                  {regime.change > 0 ? '+' : ''}{regime.change} vs prev
                </div>
              )}
            </div>

            <div>
              <div className="text-[10px] font-mono uppercase text-text-muted">Total Mcap</div>
              <div className="text-[16px] font-head font-bold tabular-nums text-text-primary">
                {regime ? fmtUsd(regime.totalMcap) : '—'}
              </div>
              {regime && (
                <DeltaBadge value={regime.mcapChange24h} size="xs" />
              )}
            </div>

            <div>
              <div className="text-[10px] font-mono uppercase text-text-muted">BTC Dominance</div>
              <div className="text-[16px] font-head font-bold tabular-nums text-text-primary">
                {regime ? `${regime.btcDom.toFixed(1)}%` : '—'}
              </div>
            </div>

            <div>
              <div className="text-[10px] font-mono uppercase text-text-muted">Intel Grade</div>
              <div className="flex items-baseline gap-2">
                <span className={`text-[22px] font-head font-bold ${intel ? scoreColor(intel.overall) : 'text-text-muted'}`}>
                  {intel ? intel.grade : '—'}
                </span>
                {intel && <span className="text-[11px] font-mono text-text-secondary tabular-nums">{intel.overall}/100</span>}
              </div>
              {intel && <div className="text-[10px] font-mono text-text-muted">{intel.regime}</div>}
            </div>

            <div>
              <div className="text-[10px] font-mono uppercase text-text-muted">Regime State</div>
              <div className="text-[16px] font-head font-bold text-text-primary">{regime ? regime.state : '—'}</div>
              {regime && <div className="text-[10px] font-mono text-text-muted">stance {regime.stance}</div>}
            </div>

            <div>
              <div className="text-[10px] font-mono uppercase text-text-muted">IDX Session</div>
              <div className="text-[16px] font-head font-bold text-text-primary">{idxTradeDate || '—'}</div>
              {idxIdeas.length > 0 && (
                <div className="text-[10px] font-mono text-text-muted">{idxIdeas.length} alpha ideas</div>
              )}
            </div>
          </div>
        </div>

        {/* ── Cross-asset tape: crypto + equity + FX + commodity + Indonesia ── */}
        {tickers.length > 0 && (
          <div className="border border-bg-border bg-bg-panel px-3 py-2">
            <div className="text-[10px] font-mono uppercase tracking-wide text-text-muted mb-2">Global Markets</div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-11 gap-x-3 gap-y-2">
              {tickers.map(t => (
                <div key={t.symbol} className="min-w-0">
                  <div className="text-[10px] font-mono uppercase text-text-muted truncate">{t.symbol}</div>
                  <div className="text-xs font-mono tabular-nums text-text-primary truncate">{t.price}</div>
                  <div className={`text-[10px] font-mono tabular-nums ${t.positive ? 'text-data-bull' : 'text-data-bear'}`}>{t.change}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Intelligence hubs: jump-off grid into every deep-dive surface ── */}
        <div className="border border-bg-border bg-bg-panel px-3 py-2">
          <div className="text-[10px] font-mono uppercase tracking-wide text-text-muted mb-2">Intelligence Hubs</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-3">
            {HUB_GROUPS.map(group => (
              <div key={group.title} className="min-w-0">
                <div className="text-[10px] font-mono uppercase text-teal-vivid mb-1 truncate">{group.title}</div>
                <ul className="space-y-0.5">
                  {group.links.map(link => (
                    <li key={link.href} className="min-w-0">
                      <Link
                        href={link.href}
                        className="block truncate text-[11px] text-text-secondary hover:text-teal-vivid transition-colors"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* ── Intelligence score breakdown ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <Panel title="Intelligence Components" subtitle="Weighted sub-scores" liveStatus={status}>
            <div className="p-2 space-y-2">
              {intelComponents.length === 0 ? (
                <div className="text-text-muted text-xs p-4">Intelligence score unavailable — retrying automatically.</div>
              ) : intelComponents.map(([name, c]) => (
                <div key={name} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono uppercase text-text-secondary">{name}</span>
                    <span className={`text-[11px] font-mono tabular-nums font-bold ${scoreColor(c.score)}`}>{c.score}</span>
                  </div>
                  <div className="h-1 bg-bg-border rounded-full overflow-hidden">
                    <div
                      className={`h-full ${c.score >= 70 ? 'bg-data-bull' : c.score >= 55 ? 'bg-teal-vivid' : c.score >= 40 ? 'bg-data-warn' : 'bg-data-bear'}`}
                      style={{ width: `${Math.max(0, Math.min(100, c.score))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Composite Signals" subtitle="Cross-factor confluence" liveStatus={status}>
            <div className="max-h-[260px] overflow-y-auto p-2 space-y-2">
              {(!intel || intel.compositeSignals.length === 0) ? (
                <div className="text-text-muted text-xs p-4">No composite confluence right now — signals surface as factors align.</div>
              ) : intel.compositeSignals.slice(0, 6).map(s => (
                <div key={s.id} className="border border-bg-border bg-bg-panel p-2 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-medium text-text-primary leading-snug">{s.name}</span>
                    <span className="text-xs shrink-0">{directionGlyph(s.direction)}</span>
                  </div>
                  {s.description && <p className="text-[11px] text-text-secondary leading-snug line-clamp-2">{s.description}</p>}
                  <div className="text-[10px] font-mono text-text-muted">strength {s.strength}</div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Top Conviction" subtitle="Ranked across markets" liveStatus={status}>
            <div className="max-h-[260px] overflow-y-auto">
              {symbolScores.length === 0 ? (
                <div className="text-text-muted text-xs p-4">No scored symbols right now — refreshing automatically.</div>
              ) : symbolScores.map(s => (
                <div key={`${s.market}:${s.symbol}`} className="flex items-center justify-between px-2 py-1 border-b border-bg-border/50 last:border-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs shrink-0">{directionGlyph(s.direction)}</span>
                    <span className="text-xs font-mono text-text-primary truncate">{s.symbol}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-mono text-text-muted uppercase">{s.market}</span>
                    <span className={`text-xs font-mono tabular-nums font-bold ${scoreColor(s.compositeScore)}`}>{s.compositeScore}</span>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* ── IDX alpha + meme alpha ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Panel
            title="IDX Alpha Ideas"
            subtitle={idxTradeDate ? `session ${idxTradeDate}` : 'value + foreign accumulation'}
            liveStatus={status}
            onRefresh={fetchAll}
          >
            <div className="max-h-[300px] overflow-y-auto">
              {idxIdeas.length === 0 ? (
                <div className="text-text-muted text-xs p-4">No IDX ideas for the latest session — harvested on weekday crons.</div>
              ) : idxIdeas.map(i => (
                <div key={i.code} className="px-2 py-1.5 border-b border-bg-border/50 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-mono font-bold text-teal-vivid shrink-0">{i.code}</span>
                      <span className="text-[11px] text-text-secondary truncate">{i.name}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <DeltaBadge value={i.changePct} size="xs" />
                      <span className={`text-xs font-mono tabular-nums font-bold ${scoreColor(i.alphaScore)}`}>
                        {i.alphaScore.toFixed(0)}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-[10px] font-mono text-text-muted">
                    <span>PER {i.per?.toFixed(1) ?? '—'}</span>
                    <span>PBV {i.pbv?.toFixed(2) ?? '—'}</span>
                    <span>ROE {i.roe?.toFixed(1) ?? '—'}%</span>
                    <span>DER {i.der?.toFixed(2) ?? '—'}</span>
                    {i.dividendYield != null && <span>DY {i.dividendYield.toFixed(1)}%</span>}
                    {i.foreignNetStreakDays > 0 && (
                      <span className={i.foreignNetStreakDir === 'accumulation' ? 'text-data-bull' : 'text-data-bear'}>
                        {i.foreignNetStreakDir === 'accumulation' ? '▲' : '▼'} {i.foreignNetStreakDays}d
                      </span>
                    )}
                    {i.alphaVerdict && <span className="uppercase text-text-secondary">{i.alphaVerdict}</span>}
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Meme Alpha" subtitle="Volume leaders across DEX platforms" liveStatus={status} onRefresh={fetchAll}>
            <div className="max-h-[300px] overflow-y-auto">
              {meme.length === 0 ? (
                <div className="text-text-muted text-xs p-4">No meme tokens with volume right now.</div>
              ) : meme.map(t => (
                <div key={t.id} className="flex items-center justify-between px-2 py-1 border-b border-bg-border/50 last:border-0 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-mono font-bold text-text-primary shrink-0">{t.symbol}</span>
                    <span className="text-[10px] font-mono uppercase text-text-muted shrink-0">{t.platform}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-mono text-text-muted tabular-nums">{fmtUsd(t.volume24h)}</span>
                    <DeltaBadge value={t.change24h} size="xs" />
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* ── Derived intelligence ── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-[20px] font-head font-bold text-text-primary">Command Center</h1>
              <p className="text-xs text-text-muted">Derived signals, global news, on-chain flows</p>
            </div>
            <LiveDot status={status} label />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Panel title="Alpha Signals" subtitle="Top derived signals" liveStatus={status}>
              <div className="max-h-[220px] overflow-y-auto space-y-2 p-2">
                {alphaSignals.length === 0 ? (
                  <div className="text-text-muted text-xs p-4">Sign in to unlock derived alpha signals.</div>
                ) : alphaSignals.map(s => (
                  <div key={s.id} className="border border-bg-border bg-bg-panel p-2 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-medium text-text-primary leading-snug">{s.headline}</span>
                      <span className="text-[10px] font-mono text-text-muted shrink-0 whitespace-nowrap">{s.timestamp}</span>
                    </div>
                    <p className="text-[11px] text-text-secondary leading-snug line-clamp-2">{s.explanation}</p>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-mono uppercase text-teal-vivid truncate">{s.source}</span>
                      <span className="text-[10px] font-mono text-text-muted shrink-0">{(s.confidence * 100).toFixed(0)}% conf</span>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="BTC Trade Thesis" subtitle="Aggregated from all alpha sources" liveStatus={status}>
              {thesis ? (
                <div className="space-y-2 p-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-mono font-bold px-2 py-1 border ${thesis.thesis === 'BULLISH' ? 'text-data-bull bg-data-bull/20 border-data-bull/30' : thesis.thesis === 'BEARISH' ? 'text-data-bear bg-data-bear/20 border-data-bear/30' : 'text-text-secondary bg-bg-raised border-bg-border'}`}>
                      {thesis.thesis}
                    </span>
                    <span className="text-xs text-text-muted font-mono">{thesis.totalSignals} signal{thesis.totalSignals === 1 ? '' : 's'}</span>
                  </div>
                  <div className="text-[11px] text-text-secondary leading-snug">
                    {thesis.thesis === 'BULLISH'
                      ? 'Weighted alpha signals lean bullish — positive conviction across derived sources.'
                      : thesis.thesis === 'BEARISH'
                        ? 'Weighted alpha signals lean bearish — caution flagged across derived sources.'
                        : 'Signals are balanced — no dominant directional edge right now.'}
                  </div>
                  <div className="text-[11px] font-mono text-text-muted">
                    Confidence {(thesis.confidence * 100).toFixed(0)}% · BTC
                  </div>
                </div>
              ) : (
                <div className="text-text-muted text-xs p-4">No trade thesis available for BTC right now.</div>
              )}
            </Panel>

            <Panel title="Trending Now" subtitle="Hottest items across all feeds" liveStatus={status}>
              <div className="space-y-2 p-2">
                {trending.length === 0 ? (
                  <div className="text-text-muted text-xs p-4">No trending items right now — refreshing automatically.</div>
                ) : trending.map((t, i) => (
                  <div key={t.id || i} className="flex items-start gap-2 border border-bg-border bg-bg-panel p-2">
                    <span className="text-xs font-mono font-bold text-teal-vivid shrink-0">#{i + 1}</span>
                    <div className="min-w-0 space-y-0.5">
                      <div className="text-xs text-text-primary leading-snug line-clamp-2">{t.title}</div>
                      {t.source && <div className="text-[10px] font-mono uppercase text-text-muted truncate">{t.source}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </div>

        {/* ── News vs DEX ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Panel title="Global News Feed" subtitle="Macro & crypto" liveStatus={status} onRefresh={fetchAll}>
            <DataTable
              columns={newsColumns as unknown as Column<Record<string, unknown>>[]}
              data={news as unknown as Record<string, unknown>[]}
              rowHeight={28}
              emptyState={<div className="text-text-muted text-xs p-4">No live news yet — refreshing every 30s.</div>}
            />
          </Panel>

          <Panel title="DEX Trending" subtitle="Hot pairs on Solana" liveStatus={status} onRefresh={fetchAll}>
            <DataTable
              columns={dexColumns as unknown as Column<Record<string, unknown>>[]}
              data={dex as unknown as Record<string, unknown>[]}
              rowHeight={28}
              emptyState={<div className="text-text-muted text-xs p-4">No trending pairs yet — refreshing every 30s.</div>}
            />
          </Panel>
        </div>

        {/* ── Smart money vs whale flows ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Panel title="Smart Money Signals" subtitle="Entity insights" liveStatus={status} onRefresh={fetchAll}>
            <DataTable
              columns={activityColumns as unknown as Column<Record<string, unknown>>[]}
              data={activity as unknown as Record<string, unknown>[]}
              rowHeight={28}
              emptyState={<div className="text-text-muted text-xs p-4">Sign in to unlock smart-money signals.</div>}
            />
          </Panel>

          <Panel title="Whale Moves" subtitle="Large on-chain flows" liveStatus={status} onRefresh={fetchAll}>
            <DataTable
              columns={whaleColumns as unknown as Column<Record<string, unknown>>[]}
              data={whaleMoves as unknown as Record<string, unknown>[]}
              rowHeight={28}
              emptyState={<div className="text-text-muted text-xs p-4">No whale moves yet — monitoring the mempool.</div>}
            />
          </Panel>
        </div>

        {/* ── Live terminal ── */}
        <Panel title="LIVE TERMINAL FEED" subtitle="Aggregated real-time intelligence from all sources" liveStatus={status}>
          <div className="h-[300px]">
            <LiveTerminalFeed />
          </div>
        </Panel>
      </div>
    </NexusLayout>
  )
}
