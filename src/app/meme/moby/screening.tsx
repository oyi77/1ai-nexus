'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { Panel } from '@/components/shell/Panel'
import { PriceTag } from '@/components/primitives/PriceTag'
import { fmtUsd } from '../_shared'
import type {
  MobyChartPoint,
  MobyLaunchpad,
  MobyPnlEntry,
  MobyScreenerGroup,
} from '@/lib/modules/meme/moby'
import type { MemeAlphaToken } from '@/lib/modules/meme/types'

const NETWORKS = ['solana', 'base', 'bnb', 'robinhood']
type Surface = 'groups' | 'launchpads' | 'tokens' | 'chart' | 'pnl'
type Status = 'live' | 'stale' | 'error'

type ApiEnvelope<T> = { data: T | null; error: string | null }

async function load<T>(surface: Surface, params: Record<string, string> = {}): Promise<T> {
  const query = new URLSearchParams({ surface, ...params })
  const response = await fetch(`/api/v1/meme/moby?${query}`)
  const body = (await response.json()) as ApiEnvelope<T>
  if (!response.ok || body.error) throw new Error(body.error ?? `Request failed (${response.status})`)
  return body.data as T
}

const riskBadgeClass = (lvl: number) => {
  if (lvl >= 3) return 'bg-data-bear/15 text-data-bear border-data-bear/30'
  if (lvl === 2) return 'bg-amber-500/15 text-amber-400 border-amber-500/30'
  if (lvl === 1) return 'bg-teal-vivid/15 text-teal-vivid border-teal-vivid/30'
  return 'bg-bg-raised text-text-muted border-border-subtle'
}

const tokenColumns: Column<MemeAlphaToken>[] = [
  {
    key: 'symbol',
    header: 'Token',
    width: 140,
    render: (row) => (
      <div className="flex flex-col min-w-0">
        <span className="font-mono font-bold text-xs text-text-primary truncate">{row.symbol}</span>
        {row.name && <span className="text-[10px] text-text-muted truncate">{row.name}</span>}
      </div>
    ),
  },
  {
    key: 'price',
    header: 'Price',
    width: 110,
    align: 'right',
    render: (row) => <PriceTag value={row.price} size="sm" />,
  },
  {
    key: 'volume',
    header: '24h Volume',
    width: 110,
    align: 'right',
    render: (row) => (
      <span className="text-xs font-mono text-text-secondary tabular-nums">
        {fmtUsd(row.volume24h)}
      </span>
    ),
  },
  {
    key: 'change',
    header: '24h Change',
    width: 100,
    align: 'right',
    render: (row) => {
      const chg = row.change24h
      const isUp = chg >= 0
      return (
        <span className={`text-xs font-mono tabular-nums ${isUp ? 'text-data-bull' : 'text-data-bear'}`}>
          {isUp ? '+' : ''}{(chg * 100).toFixed(1)}%
        </span>
      )
    },
  },
  {
    key: 'risk',
    header: 'Risk',
    width: 90,
    render: (row) => (
      <span className={`px-1.5 py-0.5 text-[10px] font-mono rounded border ${riskBadgeClass(row.riskLevel)}`}>
        Lvl {row.riskLevel}
      </span>
    ),
  },
]

const pnlColumns: Column<MobyPnlEntry>[] = [
  {
    key: 'rank',
    header: '#',
    width: 60,
    render: (row) => <span className="font-mono text-xs text-text-muted">#{row.rank}</span>,
  },
  {
    key: 'trader',
    header: 'Trader',
    render: (row) => (
      <span className="font-mono text-xs text-text-primary truncate">
        {row.displayIdentifier || row.memberNumber || row.userId}
      </span>
    ),
  },
  {
    key: 'pnl',
    header: 'PnL',
    align: 'right',
    width: 130,
    render: (row) => (
      <span className={`font-mono text-xs font-bold tabular-nums ${row.pnl >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
        {row.pnl >= 0 ? '+' : ''}${row.pnl.toLocaleString()}
      </span>
    ),
  },
  {
    key: 'twitter',
    header: 'X Profile',
    width: 120,
    render: (row) =>
      row.twitterUsername ? (
        <a
          href={`https://x.com/${row.twitterUsername}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-mono text-teal-vivid hover:underline truncate"
        >
          @{row.twitterUsername}
        </a>
      ) : (
        <span className="text-xs font-mono text-text-muted">—</span>
      ),
  },
]

export function MobyScreening() {
  const router = useRouter()
  const [network, setNetwork] = useState('solana')
  const [groups, setGroups] = useState<MobyScreenerGroup[]>([])
  const [launchpads, setLaunchpads] = useState<MobyLaunchpad[]>([])
  const [groupId, setGroupId] = useState('')
  const [tokens, setTokens] = useState<MemeAlphaToken[]>([])
  const [pnlWindow, setPnlWindow] = useState<'24h' | '7d'>('24h')
  const [pnl, setPnl] = useState<MobyPnlEntry[]>([])
  const [chart, setChart] = useState<MobyChartPoint[]>([])
  const [chartChain, setChartChain] = useState('solana')
  const [chartContract, setChartContract] = useState('')
  const [status, setStatus] = useState<Status>('stale')
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setStatus('stale')
    setError(null)
    try {
      const [nextGroups, nextLaunchpads, nextPnl] = await Promise.all([
        load<MobyScreenerGroup[]>('groups', { network }),
        load<MobyLaunchpad[]>('launchpads', { network }),
        load<MobyPnlEntry[]>('pnl', { window: pnlWindow }),
      ])
      setGroups(nextGroups)
      setLaunchpads(nextLaunchpads)
      setPnl(nextPnl)
      setGroupId((current) => nextGroups.some((group) => group.id === current) ? current : (nextGroups[0]?.id ?? ''))
      setStatus('live')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setStatus('error')
    }
  }, [network, pnlWindow])

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  useEffect(() => {
    if (!groupId) return
    void load<MemeAlphaToken[]>('tokens', { network, groupId })
      .then(setTokens)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [network, groupId])

  const fetchChart = async () => {
    if (!chartContract.trim()) return
    try {
      setChart(await load<MobyChartPoint[]>('chart', { chain: chartChain, contract: chartContract.trim() }))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const chartSummary = useMemo(() => {
    if (!chart.length) return 'No chart data'
    const first = chart[0].price
    const last = chart[chart.length - 1].price
    return `${chart.length} points · ${first === 0 ? '—' : `${(((last - first) / first) * 100).toFixed(2)}%`} over selected history`
  }, [chart])

  return (
      <div className="space-y-4">
        <Panel title="Moby Screener" subtitle="Smart-money groups, launchpads, token boards, charts and trader PnL." liveStatus={status} onRefresh={() => void refresh()}>
          <div className="flex flex-wrap gap-2">
            <label className="text-xs text-text-muted">Network<select className="ml-2 rounded border border-border-subtle bg-bg-base px-2 py-1 text-text-primary" value={network} onChange={(event) => setNetwork(event.target.value)}>{NETWORKS.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="text-xs text-text-muted">PnL<select className="ml-2 rounded border border-border-subtle bg-bg-base px-2 py-1 text-text-primary" value={pnlWindow} onChange={(event) => setPnlWindow(event.target.value as '24h' | '7d')}><option value="24h">24h</option><option value="7d">7d</option></select></label>
          </div>
          {error && <p className="mt-3 text-sm text-data-bear">{error}</p>}
        </Panel>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Groups" subtitle={`${groups.length} available`}>
            <div className="flex flex-wrap gap-2">{groups.map((group) => <button key={group.id} className={`rounded border px-3 py-2 text-left text-sm ${group.id === groupId ? 'border-data-bull text-data-bull' : 'border-border-subtle text-text-secondary'}`} onClick={() => setGroupId(group.id)}>{group.name || group.id}</button>)}{!groups.length && <p className="py-3 text-xs text-text-muted">{status === 'error' ? 'Groups unavailable.' : 'No groups available.'}</p>}</div>
          </Panel>
          <Panel title="Launchpads" subtitle={`${launchpads.length} available`}>
            <div className="flex flex-wrap gap-2">{launchpads.map((launchpad) => <span key={launchpad.id} className="rounded bg-bg-raised px-3 py-2 text-sm text-text-secondary">{launchpad.name || launchpad.id}</span>)}{!launchpads.length && <p className="py-3 text-xs text-text-muted">{status === 'error' ? 'Launchpads unavailable.' : 'No launchpads available.'}</p>}</div>
          </Panel>
        </div>

        <Panel title="Group tokens" subtitle={groupId ? `Group ${groupId}` : 'Select a group'}>
          <DataTable
            columns={tokenColumns}
            data={tokens}
            sortable
            filterable
            filterPlaceholder="Filter tokens"
            onRowClick={(row) => {
              const t = row as MemeAlphaToken
              if (t?.contract) {
                router.push(`/meme/risk?chain=${encodeURIComponent(t.chain || network)}&contract=${encodeURIComponent(t.contract)}`)
              }
            }}
            emptyState={<p className="p-6 text-center text-xs text-text-muted">{!groupId ? 'Select a group to load tokens.' : error ? 'Group tokens unavailable.' : 'No group tokens available.'}</p>}
          />
        </Panel>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Trader PnL" subtitle={`${pnlWindow} leaderboard`}><DataTable columns={pnlColumns} data={pnl} sortable emptyState={<p className="p-6 text-center text-xs text-text-muted">{status === 'error' ? 'Trader PnL unavailable.' : 'No trader PnL available.'}</p>} /></Panel>
          <Panel title="Token chart" subtitle={chartSummary}>
            <div className="flex gap-2"><select aria-label="Chart network" className="rounded border border-border-subtle bg-bg-base px-2 py-1 text-sm text-text-primary" value={chartChain} onChange={(event) => setChartChain(event.target.value)}>{NETWORKS.map((item) => <option key={item}>{item}</option>)}</select><input className="min-w-0 flex-1 rounded border border-border-subtle bg-bg-base px-2 py-1 text-sm text-text-primary" placeholder="Token contract" value={chartContract} onChange={(event) => setChartContract(event.target.value)} /><button className="rounded bg-data-bull px-3 py-1 text-sm text-bg-base" onClick={() => void fetchChart()}>Load</button></div>
            <div className="mt-3 max-h-48 overflow-auto text-xs text-text-muted">{chart.map((point) => <div className="flex justify-between border-b border-border-subtle py-1" key={`${point.ts}-${point.price}`}><span>{new Date(point.ts * 1000).toLocaleString()}</span><span>{point.price}</span></div>)}</div>
          </Panel>
        </div>
      </div>
  )
}
