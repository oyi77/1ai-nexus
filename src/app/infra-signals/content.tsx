"use client"

import { useMemo } from 'react'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'
import { useLiveFetch } from '@/lib/hooks/useLiveFetch'
import { Radio, Zap, Wifi, Activity, TrendingUp, Server, Cpu } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────

interface LightningData {
  capacityBtc: number | null
  nodeCount: number | null
  channelCount: number | null
}

interface MempoolCongestionData {
  pendingTxCount: number | null
  medianFee: number | null
  fastestFee: number | null
  halfHourFee: number | null
  hourFee: number | null
  economyFee: number | null
}

interface HashRateData {
  hashrate: number | null
  difficulty: number | null
}

interface InfraSnapshot {
  lightning: LightningData
  mempool: MempoolCongestionData
  hashRate: HashRateData
  btcPrice: { priceUsd: number | null }
  compositeScore: number
  compositeLabel: string
}

// ── Helpers ───────────────────────────────────────────────

function formatBtc(btc: number): string {
  if (btc >= 1000) return `${(btc / 1000).toFixed(1)}K BTC`
  return `${btc.toFixed(1)} BTC`
}

function formatUsd(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

function formatCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return n.toLocaleString()
}

function scoreColor(score: number): string {
  if (score >= 75) return 'text-data-bull'
  if (score >= 60) return 'text-teal-vivid'
  if (score >= 40) return 'text-data-warn'
  return 'text-data-bear'
}

function scoreBg(score: number): string {
  if (score >= 75) return 'bg-emerald-500/15 text-emerald-400'
  if (score >= 60) return 'bg-teal-500/15 text-teal-400'
  if (score >= 40) return 'bg-amber-500/15 text-amber-400'
  return 'bg-red-500/15 text-red-400'
}

function feeColor(fee: number): string {
  if (fee > 50) return 'text-data-bear'
  if (fee > 20) return 'text-data-warn'
  if (fee > 10) return 'text-text-primary'
  return 'text-data-bull'
}

function ScoreGauge({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score))
  const rotation = (pct / 100) * 180 - 90 // -90° to 90°
  const color = pct >= 75 ? '#10b981' : pct >= 60 ? '#14b8a6' : pct >= 40 ? '#f59e0b' : '#ef4444'

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-40 h-20 overflow-hidden">
        {/* Background arc */}
        <div className="absolute inset-0 rounded-t-full border-[8] border-bg-raised border-b-0" />
        {/* Foreground arc */}
        <svg viewBox="0 0 160 80" className="absolute inset-0 w-40 h-20">
          <path
            d="M 10 75 A 70 70 0 0 1 150 75"
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            className="text-bg-raised"
          />
          <path
            d="M 10 75 A 70 70 0 0 1 150 75"
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeDasharray={`${(pct / 100) * 220} 220`}
            strokeLinecap="round"
          />
        </svg>
        {/* Needle */}
        <div
          className="absolute bottom-0 left-1/2 w-0.5 h-14 origin-bottom"
          style={{
            transform: `translateX(-50%) rotate(${rotation}deg)`,
            background: `linear-gradient(to top, ${color}, transparent)`,
          }}
        />
        {/* Center dot */}
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-bg-base" style={{ background: color }} />
      </div>
      <div className={`text-[28px] font-head font-bold tabular-nums ${scoreColor(score)}`}>
        {score}
      </div>
      <div className="text-xs text-text-muted font-mono">/ 100</div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────

export function InfraSignalsPageContent() {
  return <InfraSignalsPageInner />
}



function InfraSignalsPageInner() {
  const { data: snapshot, status, refresh } = useLiveFetch<InfraSnapshot>({
    url: '/api/v1/infra-signals',
    interval: 30_000,
  })

  const ln = snapshot?.lightning
  const mp = snapshot?.mempool
  const hr = snapshot?.hashRate
  const btcPrice = snapshot?.btcPrice?.priceUsd

  const lnCapacityUsd = useMemo(() => {
    if (!ln?.capacityBtc || !btcPrice) return null
    return ln.capacityBtc * btcPrice
  }, [ln?.capacityBtc, btcPrice])

  const feeStrip = useMemo(() => {
    if (!mp) return []
    return [
      { label: 'Fastest', value: mp.fastestFee, desc: '~10 min' },
      { label: '½ Hour', value: mp.halfHourFee, desc: '~30 min' },
      { label: '1 Hour', value: mp.hourFee, desc: '~60 min' },
      { label: 'Economy', value: mp.economyFee, desc: 'low priority' },
    ]
  }, [mp])

  return (
    <>
      <div className="p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radio size={20} className="text-teal-vivid" />
            <div>
              <h1 className="text-[20px] font-head font-bold text-text-primary">Infrastructure Signals</h1>
              <p className="text-xs text-text-muted">Lightning, mempool, hash rate — real adoption vs speculation</p>
            </div>
          </div>
          <LiveDot status={status} label />
        </div>

        {/* Adoption Composite + BTC Price Strip */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
          {/* Composite Score */}
          <Panel title="Adoption Signal" subtitle="Composite infrastructure score">
            <div className="p-4 flex flex-col items-center gap-3">
              <ScoreGauge score={snapshot?.compositeScore ?? 50} />
              <div className={`text-center px-3 py-1 rounded text-xs font-mono ${scoreBg(snapshot?.compositeScore ?? 50)}`}>
                {snapshot?.compositeLabel ?? 'Loading…'}
              </div>
            </div>
          </Panel>

          {/* Quick Stats */}
          <Panel title="Infrastructure Overview" subtitle="Key metrics at a glance">
            <div className="grid grid-cols-2 divide-x divide-bg-border h-full">
              {[
                {
                  icon: Wifi,
                  label: 'Lightning Capacity',
                  value: ln?.capacityBtc ? formatBtc(ln.capacityBtc) : '—',
                  sub: lnCapacityUsd ? formatUsd(lnCapacityUsd) : null,
                  color: 'text-data-bull',
                },
                {
                  icon: Server,
                  label: 'BTC Hash Rate',
                  value: hr?.hashrate ? `${hr.hashrate.toFixed(0)} EH/s` : '—',
                  sub: hr?.difficulty ? `Diff: ${(hr.difficulty / 1e12).toFixed(1)}T` : null,
                  color: hr?.hashrate && hr.hashrate > 600 ? 'text-data-bull' : 'text-text-primary',
                },
                {
                  icon: Activity,
                  label: 'Mempool Txs',
                  value: mp?.pendingTxCount ? formatCount(mp.pendingTxCount) : '—',
                  sub: mp?.fastestFee ? `${mp.fastestFee} sat/vB` : null,
                  color: 'text-data-warn',
                },
                {
                  icon: Cpu,
                  label: 'BTC Price',
                  value: btcPrice ? formatUsd(btcPrice) : '—',
                  sub: null,
                  color: 'text-text-primary',
                },
              ].map((item, i) => (
                <div key={i} className="px-3 py-3 flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 text-xs text-text-muted font-mono uppercase tracking-wider">
                    <item.icon size={10} />
                    {item.label}
                  </div>
                  <div className={`text-[16px] font-head font-bold tabular-nums ${item.color}`}>
                    {item.value}
                  </div>
                  {item.sub && (
                    <div className="text-xs text-text-muted font-mono">{item.sub}</div>
                  )}
                </div>
              ))}
            </div>
          </Panel>

          {/* Lightning Detail */}
          <Panel title="Lightning Network" subtitle="Layer 2 adoption metrics">
            <div className="p-3 space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Total Capacity', value: ln?.capacityBtc ? formatBtc(ln.capacityBtc) : '—', color: 'text-data-bull' },
                  { label: 'Nodes', value: ln?.nodeCount ? formatCount(ln.nodeCount) : '—', color: 'text-teal-vivid' },
                  { label: 'Channels', value: ln?.channelCount ? formatCount(ln.channelCount) : '—', color: 'text-text-primary' },
                ].map((item, i) => (
                  <div key={i} className="text-center">
                    <div className="text-xs text-text-muted font-mono uppercase tracking-wider mb-1">{item.label}</div>
                    <div className={`text-[16px] font-head font-bold tabular-nums ${item.color}`}>{item.value}</div>
                  </div>
                ))}
              </div>
              {/* Capacity per node */}
              {ln?.capacityBtc && ln?.nodeCount ? (
                <div className="border-t border-bg-border pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-muted font-mono">Avg capacity / node</span>
                    <span className="text-[12px] font-mono text-text-secondary tabular-nums">
                      {(ln.capacityBtc / ln.nodeCount).toFixed(3)} BTC
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-text-muted font-mono">Channels / node</span>
                    <span className="text-[12px] font-mono text-text-secondary tabular-nums">
                      {ln.nodeCount > 0 ? (ln.channelCount! / ln.nodeCount).toFixed(1) : '—'}
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          </Panel>
        </div>

        {/* Fee Strip + Mempool Detail */}
        <Panel title="Mempool Congestion" subtitle="Fee estimates & pending tx count" liveStatus={status} onRefresh={refresh}>
          <div className="p-3 space-y-3">
            {/* Fee level strip */}
            <div className="grid grid-cols-4 divide-x divide-bg-border">
              {feeStrip.map((fee, i) => (
                <div key={i} className="px-3 py-2 text-center">
                  <div className="text-xs text-text-muted font-mono uppercase tracking-wider mb-1">{fee.label}</div>
                  <div className={`text-[20px] font-head font-bold tabular-nums ${fee.value != null ? feeColor(fee.value) : 'text-text-muted'}`}>
                    {fee.value ?? '—'}
                  </div>
                  <div className="text-xs text-text-muted font-mono">sat/vB · {fee.desc}</div>
                </div>
              ))}
            </div>

            {/* Mempool stats row */}
            <div className="grid grid-cols-3 gap-2">
              {[
                {
                  label: 'Pending Transactions',
                  value: mp?.pendingTxCount ? formatCount(mp.pendingTxCount) : '—',
                  color: mp?.pendingTxCount && mp.pendingTxCount > 80000 ? 'text-data-bear' : 'text-text-primary',
                },
                {
                  label: 'Median Fee',
                  value: mp?.medianFee ? `${mp.medianFee} sat/vB` : '—',
                  color: mp?.medianFee && mp.medianFee > 30 ? 'text-data-bear' : mp?.medianFee && mp.medianFee > 10 ? 'text-data-warn' : 'text-data-bull',
                },
                {
                  label: 'Hash Rate',
                  value: hr?.hashrate ? `${hr.hashrate.toFixed(0)} EH/s` : '—',
                  color: hr?.hashrate && hr.hashrate > 600 ? 'text-data-bull' : 'text-text-primary',
                },
              ].map((item, i) => (
                <div key={i} className="bg-bg-raised px-3 py-2 text-center">
                  <div className="text-xs text-text-muted font-mono uppercase tracking-wider mb-1">{item.label}</div>
                  <div className={`text-[16px] font-head font-bold tabular-nums ${item.color}`}>{item.value}</div>
                </div>
              ))}
            </div>

            {/* Congestion gauge bar */}
            {mp?.fastestFee != null && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-text-muted font-mono">Network Congestion</span>
                  <span className="text-xs font-mono text-text-secondary">
                    {mp.fastestFee > 50 ? 'HIGH' : mp.fastestFee > 20 ? 'MODERATE' : mp.fastestFee > 10 ? 'NORMAL' : 'LOW'}
                  </span>
                </div>
                <div className="w-full h-2 bg-bg-raised rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${Math.min(100, (mp.fastestFee / 100) * 100)}%`,
                      background: mp.fastestFee > 50
                        ? 'linear-gradient(90deg, #f59e0b, #ef4444)'
                        : mp.fastestFee > 20
                          ? 'linear-gradient(90deg, #14b8a6, #f59e0b)'
                          : 'linear-gradient(90deg, #10b981, #14b8a6)',
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </Panel>

        {/* Hash Rate Detail */}
        <Panel title="Hash Rate & Security" subtitle="Bitcoin network mining metrics">
          <div className="p-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              {[
                {
                  icon: Zap,
                  label: 'Hash Rate',
                  value: hr?.hashrate ? `${hr.hashrate.toFixed(1)} EH/s` : '—',
                  sub: 'Network security',
                  color: hr?.hashrate && hr.hashrate > 600 ? 'text-data-bull' : 'text-text-primary',
                },
                {
                  icon: Activity,
                  label: 'Difficulty',
                  value: hr?.difficulty ? `${(hr.difficulty / 1e12).toFixed(2)}T` : '—',
                  sub: 'Mining difficulty',
                  color: 'text-text-primary',
                },
                {
                  icon: TrendingUp,
                  label: 'Hash Rate Signal',
                  value: hr?.hashrate
                    ? hr.hashrate > 700 ? 'Strong' : hr.hashrate > 500 ? 'Healthy' : hr.hashrate > 300 ? 'Moderate' : 'Weak'
                    : '—',
                  sub: 'Miner confidence',
                  color: hr?.hashrate
                    ? hr.hashrate > 700 ? 'text-data-bull' : hr.hashrate > 500 ? 'text-teal-vivid' : hr.hashrate > 300 ? 'text-data-warn' : 'text-data-bear'
                    : 'text-text-muted',
                },
                {
                  icon: Server,
                  label: 'Network',
                  value: 'Bitcoin',
                  sub: 'Layer 1 base',
                  color: 'text-data-bull',
                },
              ].map((item, i) => (
                <div key={i} className="bg-bg-raised px-3 py-3 flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 text-xs text-text-muted font-mono uppercase tracking-wider">
                    <item.icon size={10} />
                    {item.label}
                  </div>
                  <div className={`text-[16px] font-head font-bold tabular-nums ${item.color}`}>{item.value}</div>
                  <div className="text-xs text-text-muted font-mono">{item.sub}</div>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        {/* Methodology */}
        <Panel title="Methodology" subtitle="How infrastructure signals work">
          <div className="p-3 space-y-2 text-xs text-text-secondary">
            <div className="flex items-start gap-2">
              <span className="text-teal-vivid font-bold">1.</span>
              <span><b>Lightning Network</b> — capacity, node count, and channel count from 1ml.com API. Growing Lightning = real BTC payment adoption.</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-teal-vivid font-bold">2.</span>
              <span><b>Mempool Congestion</b> — pending tx count and fee estimates from mempool.space. High fees + full mempool = real demand for block space.</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-teal-vivid font-bold">3.</span>
              <span><b>Hash Rate</b> — current hashrate from mempool.space. Rising hash rate = miners investing capital, signal of long-term confidence.</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-teal-vivid font-bold">4.</span>
              <span><b>Composite Score</b> — weighted blend of all metrics (0–100). Above 75 = strong adoption; below 40 = infrastructure stress or speculation-only.</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-teal-vivid font-bold">5.</span>
              <span><b>Sources:</b> 1ml.com (Lightning), mempool.space (mempool + hash rate), CoinGecko (BTC price). All free, no API keys.</span>
            </div>
          </div>
        </Panel>
      </div>
    </>
  )
}
