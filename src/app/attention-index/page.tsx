"use client"

import { useState, useEffect } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'
import { useTableControls, TableControlsBar, SortableTh } from '@/components/shell/TableControls'

type RepoVelocity = {
  repo: string
  owner: string
  stars: number
  forks: number
  openIssues: number
  weeklyCommits: number
  commitHistory: number[]
  contributorCount: number
}

const GITHUB_COLUMNS = [
  { key: 'repo' },
  { key: 'stars' },
  { key: 'forks' },
  { key: 'openIssues' },
  { key: 'contributorCount' },
  { key: 'weeklyCommits' },
]

interface TrendingCoin {
  name: string
  symbol: string
  score: number
  rank: number
}

interface AttentionData {
  github: {
    repos: RepoVelocity[]
    totals: {
      totalStars: number
      totalForks: number
      totalWeeklyCommits: number
      avgWeeklyCommits: number
    }
    timestamp: string
  }
  search: {
    trendingCoins: TrendingCoin[]
    bitcoinTrend: number
    ethereumTrend: number
    cryptoTrend: number
  }
  composite: {
    githubScore: number
    searchScore: number
    attentionIndex: number
    signal: string
  }
  timestamp: string
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

function signalColor(signal: string): string {
  switch (signal) {
    case 'surging': return 'text-data-bull bg-data-bull/20'
    case 'rising': return 'text-accent-green bg-accent-green/20'
    case 'stable': return 'text-accent-cyan bg-accent-cyan/20'
    case 'cooling': return 'text-accent-amber bg-accent-amber/20'
    case 'declining': return 'text-data-bear bg-data-bear/20'
    default: return 'text-text-dim bg-bg-elevated'
  }
}

function CommitSparkline({ history }: { history: number[] }) {
  const max = Math.max(...history, 1)
  return (
    <div className="flex items-end gap-0.5 h-4">
      {history.map((v, i) => (
        <div
          key={i}
          className="w-2 bg-accent-cyan/60 rounded-sm"
          style={{ height: `${(v / max) * 100}%`, minHeight: '2px' }}
          title={`${v} commits`}
        />
      ))}
    </div>
  )
}

export default function AttentionIndexPage() {
  const [data, setData] = useState<AttentionData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/v1/attention-index')
        const d = await res.json()
        if (d.data) setData(d.data)
      } catch { /* graceful */ }
      setLoading(false)
    }
    fetchData()
  }, [])
  // Default ordering preserved from the previous inline weeklyCommits-desc sort.
  const tc = useTableControls(data?.github.repos, GITHUB_COLUMNS, { initialSortKey: 'weeklyCommits', initialSortDir: 'desc' })

  return (
    <NexusLayout>
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">ATTENTION INDEX</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              GitHub developer velocity + search attention — weighted composite signal
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : 'live'} label />
        </div>

        {/* Composite Score */}
        {data && (
          <Panel title="Composite Signal" subtitle="Weighted attention score — 60% dev velocity, 40% search attention">
            <div className="p-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-bg-elevated rounded-lg p-4 border border-border-dim/30 text-center">
                  <p className="text-[10px] text-text-muted font-mono">ATTENTION INDEX</p>
                  <p className="text-3xl font-mono font-bold mt-1">{data.composite.attentionIndex}</p>
                  <span className={`inline-block mt-2 text-[10px] font-mono px-2 py-0.5 rounded ${signalColor(data.composite.signal)}`}>
                    {data.composite.signal.toUpperCase()}
                  </span>
                </div>
                <div className="bg-bg-elevated rounded-lg p-4 border border-border-dim/30 text-center">
                  <p className="text-[10px] text-text-muted font-mono">GITHUB SCORE</p>
                  <p className="text-3xl font-mono font-bold mt-1 text-accent-green">{data.composite.githubScore}</p>
                  <p className="text-[9px] text-text-dim mt-1">{fmtNum(data.github.totals.totalWeeklyCommits)} commits/wk</p>
                </div>
                <div className="bg-bg-elevated rounded-lg p-4 border border-border-dim/30 text-center">
                  <p className="text-[10px] text-text-muted font-mono">SEARCH SCORE</p>
                  <p className="text-3xl font-mono font-bold mt-1 text-accent-amber">{data.composite.searchScore}</p>
                  <p className="text-[9px] text-text-dim mt-1">Trending proxy</p>
                </div>
                <div className="bg-bg-elevated rounded-lg p-4 border border-border-dim/30 text-center">
                  <p className="text-[10px] text-text-muted font-mono">TOTAL STARS</p>
                  <p className="text-3xl font-mono font-bold mt-1">{fmtNum(data.github.totals.totalStars)}</p>
                  <p className="text-[9px] text-text-dim mt-1">{data.github.repos.length} repos tracked</p>
                </div>
              </div>
            </div>
          </Panel>
        )}

        {/* GitHub Velocity Table */}
        {data && (
          <Panel title="GitHub Developer Velocity" subtitle={`${data.github.repos.length} crypto repos — stars, forks, weekly commits`}>
            <TableControlsBar idPrefix="attention-index" query={tc.query} onQueryChange={tc.setQuery} shown={tc.visible.length} total={tc.total} />
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-text-muted border-b border-border-dim">
                    <th className="text-left py-2 px-2 font-mono">#</th>
                    <SortableTh controls={tc} k="repo" className="text-left py-2 px-2 font-mono">REPO</SortableTh>
                    <SortableTh controls={tc} k="stars" className="text-right py-2 px-2 font-mono">STARS</SortableTh>
                    <SortableTh controls={tc} k="forks" className="text-right py-2 px-2 font-mono">FORKS</SortableTh>
                    <SortableTh controls={tc} k="openIssues" className="text-right py-2 px-2 font-mono">ISSUES</SortableTh>
                    <SortableTh controls={tc} k="contributorCount" className="text-right py-2 px-2 font-mono">CONTRIBS</SortableTh>
                    <SortableTh controls={tc} k="weeklyCommits" className="text-right py-2 px-2 font-mono">COMMITS/WK</SortableTh>
                    <th className="text-left py-2 px-2 font-mono w-24">TREND</th>
                  </tr>
                </thead>
                <tbody>
                  {tc.visible.map((repo, i) => (
                    <tr key={repo.repo} className="border-b border-border-dim/30 hover:bg-bg-elevated">
                      <td className="py-2 px-2 text-text-dim">{i + 1}</td>
                      <td className="py-2 px-2">
                        <a
                          href={`https://github.com/${repo.repo}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono font-bold text-teal-vivid hover:underline"
                        >
                          {repo.repo}
                        </a>
                      </td>
                      <td className="py-2 px-2 text-right font-mono">{fmtNum(repo.stars)}</td>
                      <td className="py-2 px-2 text-right font-mono">{fmtNum(repo.forks)}</td>
                      <td className="py-2 px-2 text-right font-mono">{fmtNum(repo.openIssues)}</td>
                      <td className="py-2 px-2 text-right font-mono">{fmtNum(repo.contributorCount)}</td>
                      <td className="py-2 px-2 text-right font-mono font-bold">{repo.weeklyCommits}</td>
                      <td className="py-2 px-2">
                        <CommitSparkline history={repo.commitHistory} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        {/* Search Attention */}
        {data && (
          <Panel title="Search Attention" subtitle="CoinGecko trending proxy — coins with highest community attention">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 p-3">
              <div className="bg-bg-elevated rounded-lg p-3 border border-border-dim/30">
                <p className="text-[10px] text-text-muted font-mono">BITCOIN TREND</p>
                <p className="text-xl font-mono font-bold mt-1">{Math.round(data.search.bitcoinTrend)}</p>
              </div>
              <div className="bg-bg-elevated rounded-lg p-3 border border-border-dim/30">
                <p className="text-[10px] text-text-muted font-mono">ETHEREUM TREND</p>
                <p className="text-xl font-mono font-bold mt-1">{Math.round(data.search.ethereumTrend)}</p>
              </div>
              <div className="bg-bg-elevated rounded-lg p-3 border border-border-dim/30">
                <p className="text-[10px] text-text-muted font-mono">CRYPTO TREND</p>
                <p className="text-xl font-mono font-bold mt-1">{Math.round(data.search.cryptoTrend)}</p>
              </div>
            </div>
            {data.search.trendingCoins.length > 0 && (
              <div className="p-3 pt-0">
                <p className="text-[10px] text-text-muted font-mono mb-2">TRENDING COINS (CoinGecko)</p>
                <div className="flex flex-wrap gap-2">
                  {data.search.trendingCoins.map(coin => (
                    <span
                      key={coin.symbol}
                      className="text-[10px] font-mono px-2 py-1 rounded bg-bg-raised border border-border-dim/30"
                    >
                      {coin.symbol.toUpperCase()} <span className="text-text-dim">#{coin.rank}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Panel>
        )}

        {/* Aggregate Summary */}
        {data && (
          <Panel title="Aggregate Summary" subtitle="Combined GitHub metrics across all tracked repos">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3">
              <div className="bg-bg-elevated rounded-lg p-3 border border-border-dim/30">
                <p className="text-[10px] text-text-muted font-mono">TOTAL STARS</p>
                <p className="text-lg font-mono font-bold mt-1">{fmtNum(data.github.totals.totalStars)}</p>
              </div>
              <div className="bg-bg-elevated rounded-lg p-3 border border-border-dim/30">
                <p className="text-[10px] text-text-muted font-mono">TOTAL FORKS</p>
                <p className="text-lg font-mono font-bold mt-1">{fmtNum(data.github.totals.totalForks)}</p>
              </div>
              <div className="bg-bg-elevated rounded-lg p-3 border border-border-dim/30">
                <p className="text-[10px] text-text-muted font-mono">TOTAL COMMITS/WK</p>
                <p className="text-lg font-mono font-bold mt-1">{fmtNum(data.github.totals.totalWeeklyCommits)}</p>
              </div>
              <div className="bg-bg-elevated rounded-lg p-3 border border-border-dim/30">
                <p className="text-[10px] text-text-muted font-mono">AVG COMMITS/WK</p>
                <p className="text-lg font-mono font-bold mt-1">{Math.round(data.github.totals.avgWeeklyCommits)}</p>
              </div>
            </div>
          </Panel>
        )}

        {/* Methodology */}
        <Panel title="Methodology" subtitle="How the attention index is calculated">
          <div className="p-4 text-xs text-text-dim space-y-2">
            <p><strong className="text-text-primary">GitHub Velocity (60%):</strong> Weekly commit count across 6 top crypto repos (bitcoin, go-ethereum, solana, v3-core, aave-v3, metamask). Normalized to 0-100 (500 commits/week = 100).</p>
            <p><strong className="text-text-primary">Search Attention (40%):</strong> CoinGecko trending coin scores as proxy for search interest. Normalized to 0-100.</p>
            <p><strong className="text-text-primary">Composite Signal:</strong> Weighted average mapped to signal: surging (80+), rising (60+), stable (40+), cooling (20+), declining (&lt;20).</p>
            <p><strong className="text-text-primary">Data Sources:</strong> GitHub API (public, 5000 req/hr), CoinGecko public API (no key).</p>
            <p><strong className="text-text-primary">Limitations:</strong> GitHub commit activity has a 1-week lag. CoinGecko trending is a proxy, not direct Google Trends data. Historical data accumulates over time.</p>
          </div>
        </Panel>
      </div>
    </NexusLayout>
  )
}
