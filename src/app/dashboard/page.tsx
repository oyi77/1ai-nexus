"use client"
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { PersonalizedGrid, type PanelDef } from '@/components/features/PersonalizedGrid'
import { Panel } from '@/components/shell/Panel'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { PriceTag } from '@/components/primitives/PriceTag'
import { DeltaBadge } from '@/components/primitives/DeltaBadge'
import { LiveDot } from '@/components/primitives/LiveDot'
import { LiveTerminalFeed } from '@/components/features/LiveTerminalFeed'

import type {
  Regime, Ticker, IntelScore, SymbolScore, IdxIdea, MemeToken, NewsItem,
  DexTrending, WhaleMove, ActivityEvent, AlphaSignalCard, ThesisCard, TrendingCard,
  MacroCountry,
} from './types'
import { scoreColor, directionGlyph, regimeAccent, fmtUsd } from './types'
import { fetchAll, type DashboardState } from './fetch'

const HUB_GROUPS: Array<{ title: string; links: Array<{ label: string; href: string }> }> =  [
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
  const [macro, setMacro] = useState<Record<string, MacroCountry>>({})
  const [lastUpdated, setLastUpdated] = useState('')

  // One refresh path for the whole board — every panel shares a single
  // failure-tolerant fan-out instead of competing polling loops.
  const state: DashboardState = {
    setRegime, setTickers, setIntel, setSymbolScores, setIdxIdeas, setIdxTradeDate,
    setMeme, setNews, setDex, setWhaleMoves, setActivity, setAlphaSignals,
    setThesis, setTrending, setStatus, setMacro, setLastUpdated,
  }

  useEffect(() => {
    fetchAll(state)
    const interval = setInterval(() => fetchAll(state), 30_000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only polling; setters are stable
  }, [])

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

  // Personalized dashboard panels — drag to reorder when "Customize" is active
  const gridPanels: PanelDef[] = [
    {
      id: 'intel-components', title: 'Intelligence Components', defaultW: 4, defaultH: 6,
      content: (
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
      ),
    },
    {
      id: 'top-conviction', title: 'Top Conviction', defaultW: 4, defaultH: 6,
      content: (
        <div className="max-h-full overflow-y-auto">
          {symbolScores.length === 0 ? (
            <div className="text-text-muted text-xs p-4">No scored symbols right now — refreshing automatically.</div>
          ) : symbolScores.map(ss => (
            <div key={`${ss.market}:${ss.symbol}`} className="flex items-center justify-between px-2 py-1 border-b border-bg-border/50 last:border-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs shrink-0">{directionGlyph(ss.direction)}</span>
                <span className="text-xs font-mono text-text-primary truncate">{ss.symbol}</span>
              </div>
              <span className={`text-xs font-mono tabular-nums font-bold ${scoreColor(ss.compositeScore)}`}>{ss.compositeScore}</span>
            </div>
          ))}
        </div>
      ),
    },
    {
      id: 'btc-thesis', title: 'BTC Trade Thesis', defaultW: 4, defaultH: 4,
      content: thesis ? (
        <div className="space-y-2 p-2">
          <span className={`text-xs font-mono font-bold px-2 py-1 border ${
            thesis.thesis === 'BULLISH' ? 'text-data-bull border-data-bull/30 bg-data-bull/20' :
            thesis.thesis === 'BEARISH' ? 'text-data-bear border-data-bear/30 bg-data-bear/20' :
            'text-text-secondary border-bg-border'
          }`}>{thesis.thesis}</span>
          <div className="text-[11px] text-text-muted font-mono">
            Confidence {(thesis.confidence * 100).toFixed(0)}% &middot; {thesis.totalSignals} signals
          </div>
        </div>
      ) : (
        <div className="text-text-muted text-xs p-4">No trade thesis available for BTC right now.</div>
      ),
    },
  ]

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


        {/* Global macro: cross-country GDP / inflation / unemployment / rates */}
        {Object.keys(macro).length > 0 && (
          <div className="border border-bg-border bg-bg-panel px-3 py-2">
            <div className="text-[10px] font-mono uppercase tracking-wide text-text-muted mb-2">
              Global Macro ~ {Object.keys(macro).length} economies
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-9 gap-x-3 gap-y-2">
              {Object.entries(macro).map(([country, m]) => (
                <div key={country} className="min-w-0">
                  <div className="text-[10px] font-mono uppercase text-teal-vivid truncate">{country}</div>
                  <div className="text-[10px] font-mono text-text-muted truncate">GDP {m.GDP || '-'}</div>
                  <div className="text-[10px] font-mono text-text-muted truncate">
                    growth {m['GDP Growth'] || '-'} ~ infl {m.Inflation || '-'}
                  </div>
                  <div className="text-[10px] font-mono text-text-muted truncate">
                    unemp {m.Unemployment || '-'} ~ real {m['Real Interest'] || '-'}
                  </div>
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

        {/* ── Intelligence score breakdown (personalized) ── */}
        <div className="border border-bg-border bg-bg-panel px-3 py-2">
          <div className="text-[10px] font-mono uppercase tracking-wide text-text-muted mb-2">Intelligence Hub</div>
          <PersonalizedGrid panels={gridPanels} />
        </div>

        {/* ── IDX alpha + meme alpha ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Panel
            title="IDX Alpha Ideas"
            subtitle={idxTradeDate ? `session ${idxTradeDate}` : 'value + foreign accumulation'}
            liveStatus={status}
            onRefresh={() => fetchAll(state)}
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

          <Panel title="Meme Alpha" subtitle="Volume leaders across DEX platforms" liveStatus={status} onRefresh={() => fetchAll(state)}>
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
          <Panel title="Global News Feed" subtitle="Macro & crypto" liveStatus={status} onRefresh={() => fetchAll(state)}>
            <DataTable
              columns={newsColumns as unknown as Column<Record<string, unknown>>[]}
              data={news as unknown as Record<string, unknown>[]}
              rowHeight={28}
              emptyState={<div className="text-text-muted text-xs p-4">No live news yet — refreshing every 30s.</div>}
            />
          </Panel>

          <Panel title="DEX Trending" subtitle="Hot pairs on Solana" liveStatus={status} onRefresh={() => fetchAll(state)}>
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
          <Panel title="Smart Money Signals" subtitle="Entity insights" liveStatus={status} onRefresh={() => fetchAll(state)}>
            <DataTable
              columns={activityColumns as unknown as Column<Record<string, unknown>>[]}
              data={activity as unknown as Record<string, unknown>[]}
              rowHeight={28}
              emptyState={<div className="text-text-muted text-xs p-4">Sign in to unlock smart-money signals.</div>}
            />
          </Panel>

          <Panel title="Whale Moves" subtitle="Large on-chain flows" liveStatus={status} onRefresh={() => fetchAll(state)}>
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
