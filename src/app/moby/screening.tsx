'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { DataTable, type Column } from '@/components/shell/DataTable'
import { Panel } from '@/components/shell/Panel'
import { NexusLayout } from '@/components/layout/NexusLayout'
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

const tokenColumns: Column<MemeAlphaToken>[] = [
  { key: 'symbol', header: 'Token', accessor: (row) => row.symbol },
  { key: 'price', header: 'Price', align: 'right', accessor: (row) => row.price },
  { key: 'volume', header: '24h volume', align: 'right', accessor: (row) => row.volume24h },
  { key: 'change', header: '24h', align: 'right', accessor: (row) => row.change24h },
  { key: 'risk', header: 'Risk', accessor: (row) => row.riskLevel },
]

const pnlColumns: Column<MobyPnlEntry>[] = [
  { key: 'rank', header: '#', accessor: (row) => row.rank },
  { key: 'trader', header: 'Trader', accessor: (row) => row.displayIdentifier || row.memberNumber || row.userId },
  { key: 'pnl', header: 'PnL', align: 'right', accessor: (row) => row.pnl, render: (row) => `$${row.pnl.toLocaleString()}` },
  { key: 'twitter', header: 'X', accessor: (row) => row.twitterUsername ?? '' },
]

export function MobyScreening() {
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
    <NexusLayout>
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
            <div className="flex flex-wrap gap-2">{groups.map((group) => <button key={group.id} className={`rounded border px-3 py-2 text-left text-sm ${group.id === groupId ? 'border-data-bull text-data-bull' : 'border-border-subtle text-text-secondary'}`} onClick={() => setGroupId(group.id)}>{group.name || group.id}</button>)}</div>
          </Panel>
          <Panel title="Launchpads" subtitle={`${launchpads.length} available`}>
            <div className="flex flex-wrap gap-2">{launchpads.map((launchpad) => <span key={launchpad.id} className="rounded bg-bg-raised px-3 py-2 text-sm text-text-secondary">{launchpad.name || launchpad.id}</span>)}</div>
          </Panel>
        </div>

        <Panel title="Group tokens" subtitle={groupId ? `Group ${groupId}` : 'Select a group'}>
          <DataTable columns={tokenColumns} data={tokens} sortable filterable filterPlaceholder="Filter tokens" />
        </Panel>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Trader PnL" subtitle={`${pnlWindow} leaderboard`}><DataTable columns={pnlColumns} data={pnl} sortable /></Panel>
          <Panel title="Token chart" subtitle={chartSummary}>
            <div className="flex gap-2"><select aria-label="Chart network" className="rounded border border-border-subtle bg-bg-base px-2 py-1 text-sm text-text-primary" value={chartChain} onChange={(event) => setChartChain(event.target.value)}>{NETWORKS.map((item) => <option key={item}>{item}</option>)}</select><input className="min-w-0 flex-1 rounded border border-border-subtle bg-bg-base px-2 py-1 text-sm text-text-primary" placeholder="Token contract" value={chartContract} onChange={(event) => setChartContract(event.target.value)} /><button className="rounded bg-data-bull px-3 py-1 text-sm text-bg-base" onClick={() => void fetchChart()}>Load</button></div>
            <div className="mt-3 max-h-48 overflow-auto text-xs text-text-muted">{chart.map((point) => <div className="flex justify-between border-b border-border-subtle py-1" key={`${point.ts}-${point.price}`}><span>{new Date(point.ts * 1000).toLocaleString()}</span><span>{point.price}</span></div>)}</div>
          </Panel>
        </div>
      </div>
    </NexusLayout>
  )
}
