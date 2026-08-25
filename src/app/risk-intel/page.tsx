"use client"

import { useState, useEffect, useMemo } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'
import { useTableControls, TableControlsBar, SortableTh } from '@/components/shell/TableControls'

type CreditRisk = {
  protocol: string
  chain: string
  tvl: number
  avgApy: number
  riskLevel: string
  signal: string
}

interface MinerFlow {
  hashRate: number | null
  hashRateUnit: string
  blockHeight: number | null
  difficulty: number | null
  signal: string
}

type SectorFlow = {
  sector: string
  marketCap: number
  change24h: number
  change7d: number
  topCoins: string[]
  signal: string
}

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
  return `$${n.toFixed(0)}`
}

export default function RiskIntelPage() {
  const [creditRisk, setCreditRisk] = useState<CreditRisk[]>([])
  const [minerFlow, setMinerFlow] = useState<MinerFlow | null>(null)
  const [narrative, setNarrative] = useState<SectorFlow[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'credit' | 'miner' | 'narrative'>('credit')
  const creditTc = useTableControls(creditRisk, undefined, { initialSortKey: 'tvl', initialSortDir: 'desc' })
  const narrativeTc = useTableControls(narrative, undefined, { initialSortKey: 'marketCap', initialSortDir: 'desc' })

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/v1/risk-intel?action=all')
        const d = await res.json()
        if (d.data?.creditRisk) setCreditRisk(d.data.creditRisk)
        if (d.data?.minerFlow) setMinerFlow(d.data.minerFlow)
        if (d.data?.narrative) setNarrative(d.data.narrative)
        setLoading(false)
      } catch { setLoading(false) }
    }
    fetchData()
    const interval = setInterval(fetchData, 300_000)
    return () => clearInterval(interval)
  }, [])

  const topInflows = useMemo(() => narrative.filter(s => s.signal === 'inflow').slice(0, 5), [narrative])
  const topOutflows = useMemo(() => narrative.filter(s => s.signal === 'outflow').slice(0, 5), [narrative])

  return (
    <NexusLayout>
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">RISK INTELLIGENCE</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              DeFi credit stress, miner behavior, narrative rotation — all from public APIs
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : 'live'} label />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border-dim">
          {([['credit', 'Credit Risk'], ['miner', 'Miner Flow'], ['narrative', 'Narrative Rotation']] as const).map(([key, label]) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={`px-4 py-2 text-xs font-mono transition-colors ${
                activeTab === key ? 'text-accent-cyan border-b-2 border-accent-cyan font-bold' : 'text-text-muted hover:text-text-primary'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* Credit Risk */}
        {activeTab === 'credit' && (
          <Panel title="DeFi Credit Stress" subtitle={`${creditRisk.length} elevated-risk protocols`}>
            {creditRisk.length === 0 ? (
              <div className="text-text-muted text-[11px] p-4 text-center">No elevated credit risk detected</div>
            ) : (
              <>
                <TableControlsBar idPrefix="risk-intel" query={creditTc.query} onQueryChange={creditTc.setQuery} shown={creditTc.visible.length} total={creditTc.total} />
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-text-muted border-b border-border-dim">
                      <SortableTh controls={creditTc} k="protocol" className="text-left py-2 px-2 font-mono">PROTOCOL</SortableTh>
                      <SortableTh controls={creditTc} k="chain" className="text-left py-2 px-2 font-mono">CHAIN</SortableTh>
                      <SortableTh controls={creditTc} k="tvl" className="text-right py-2 px-2 font-mono">TVL</SortableTh>
                      <SortableTh controls={creditTc} k="avgApy" className="text-right py-2 px-2 font-mono">AVG APY</SortableTh>
                      <SortableTh controls={creditTc} k="riskLevel" className="text-left py-2 px-2 font-mono">RISK</SortableTh>
                      <SortableTh controls={creditTc} k="signal" className="text-left py-2 px-2 font-mono">SIGNAL</SortableTh>
                    </tr>
                  </thead>
                  <tbody>
                    {creditTc.visible.map((c, i) => (
                      <tr key={i} className="border-b border-border-dim/30 hover:bg-bg-elevated">
                        <td className="py-2 px-2 font-mono font-bold text-teal-vivid">{c.protocol}</td>
                        <td className="py-2 px-2 text-text-dim">{c.chain}</td>
                        <td className="py-2 px-2 text-right font-mono">{fmtUsd(c.tvl)}</td>
                        <td className={`py-2 px-2 text-right font-mono font-bold ${
                          c.riskLevel === 'critical' ? 'text-data-bear' : c.riskLevel === 'high' ? 'text-accent-amber' : 'text-text-muted'
                        }`}>{c.avgApy.toFixed(2)}%</td>
                        <td className="py-2 px-2">
                          <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                            c.riskLevel === 'critical' ? 'bg-data-bear/20 text-data-bear' :
                            c.riskLevel === 'high' ? 'bg-accent-amber/20 text-accent-amber' :
                            'bg-bg-raised text-text-muted'
                          }`}>{c.riskLevel}</span>
                        </td>
                        <td className="py-2 px-2 text-text-dim">{c.signal}</td>
                      </tr>
                    ))}
                    {creditTc.visible.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-3 text-center text-text-muted font-mono">No protocols match the current filter.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              </>
            )}
          </Panel>
        )}

        {/* Miner Flow */}
        {activeTab === 'miner' && minerFlow && (
          <Panel title="Bitcoin Miner Intelligence" subtitle="Hash rate + miner behavior signals">
            <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-[10px] text-text-muted font-mono">HASH RATE</p>
                <p className="text-lg font-mono font-bold">{minerFlow.hashRate ? `${minerFlow.hashRate.toFixed(1)} EH/s` : '—'}</p>
              </div>
              <div>
                <p className="text-[10px] text-text-muted font-mono">BLOCK HEIGHT</p>
                <p className="text-lg font-mono font-bold">{minerFlow.blockHeight?.toLocaleString() ?? '—'}</p>
              </div>
              <div>
                <p className="text-[10px] text-text-muted font-mono">DIFFICULTY</p>
                <p className="text-lg font-mono font-bold">{minerFlow.difficulty ? `${(minerFlow.difficulty / 1e12).toFixed(1)}T` : '—'}</p>
              </div>
              <div>
                <p className="text-[10px] text-text-muted font-mono">SIGNAL</p>
                <p className="text-sm font-mono font-bold">{minerFlow.signal}</p>
              </div>
            </div>
          </Panel>
        )}

        {/* Narrative Rotation */}
        {activeTab === 'narrative' && (
          <div className="space-y-4">
            {/* Top inflows/outflows */}
            <div className="grid grid-cols-2 gap-4">
              <Panel title="Top Inflows" subtitle="Sectors with capital rotation in">
                {topInflows.length === 0 ? (
                  <div className="text-text-muted text-[11px] p-4 text-center">No inflow signals</div>
                ) : (
                  <div className="p-3 space-y-2">
                    {topInflows.map((s, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-mono font-bold text-data-bull">{s.sector}</p>
                          <p className="text-[9px] text-text-dim">{s.topCoins.slice(0, 3).join(', ')}</p>
                        </div>
                        <span className="text-sm font-mono font-bold text-data-bull">+{s.change24h.toFixed(2)}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
              <Panel title="Top Outflows" subtitle="Sectors with capital rotation out">
                {topOutflows.length === 0 ? (
                  <div className="text-text-muted text-[11px] p-4 text-center">No outflow signals</div>
                ) : (
                  <div className="p-3 space-y-2">
                    {topOutflows.map((s, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-mono font-bold text-data-bear">{s.sector}</p>
                          <p className="text-[9px] text-text-dim">{s.topCoins.slice(0, 3).join(', ')}</p>
                        </div>
                        <span className="text-sm font-mono font-bold text-data-bear">{s.change24h.toFixed(2)}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            </div>

            {/* Full narrative table */}
            <Panel title="Narrative Sectors" subtitle={`${narrative.length} sectors from CoinGecko`}>
                <TableControlsBar idPrefix="risk-intel-2" query={narrativeTc.query} onQueryChange={narrativeTc.setQuery} shown={narrativeTc.visible.length} total={narrativeTc.total} />
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-text-muted border-b border-border-dim">
                      <SortableTh controls={narrativeTc} k="sector" className="text-left py-2 px-2 font-mono">SECTOR</SortableTh>
                      <SortableTh controls={narrativeTc} k="marketCap" className="text-right py-2 px-2 font-mono">MCAP</SortableTh>
                      <SortableTh controls={narrativeTc} k="change24h" className="text-right py-2 px-2 font-mono">24H</SortableTh>
                      <SortableTh controls={narrativeTc} k="change7d" className="text-right py-2 px-2 font-mono">7D</SortableTh>
                      <SortableTh controls={narrativeTc} k="signal" className="text-left py-2 px-2 font-mono">SIGNAL</SortableTh>
                      <SortableTh controls={narrativeTc} k="topCoins" className="text-left py-2 px-2 font-mono">TOP COINS</SortableTh>
                    </tr>
                  </thead>
                  <tbody>
                    {narrativeTc.visible.map((s, i) => (
                      <tr key={i} className="border-b border-border-dim/30 hover:bg-bg-elevated">
                        <td className="py-2 px-2 font-mono font-bold text-teal-vivid">{s.sector}</td>
                        <td className="py-2 px-2 text-right font-mono">{fmtUsd(s.marketCap)}</td>
                        <td className={`py-2 px-2 text-right font-mono font-bold ${s.change24h >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                          {s.change24h >= 0 ? '+' : ''}{s.change24h.toFixed(2)}%
                        </td>
                        <td className={`py-2 px-2 text-right font-mono ${s.change7d >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                          {s.change7d >= 0 ? '+' : ''}{s.change7d.toFixed(2)}%
                        </td>
                        <td className="py-2 px-2">
                          <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                            s.signal === 'inflow' ? 'bg-data-bull/20 text-data-bull' :
                            s.signal === 'outflow' ? 'bg-data-bear/20 text-data-bear' :
                            'bg-bg-raised text-text-muted'
                          }`}>{s.signal}</span>
                        </td>
                        <td className="py-2 px-2 text-text-dim">{s.topCoins.slice(0, 3).join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        )}
      </div>
    </NexusLayout>
  )
}
