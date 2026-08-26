"use client"

import { useState, useEffect } from "react"
import { NexusLayout } from "@/components/layout/NexusLayout"
import { LiveDot } from "@/components/primitives/LiveDot"

type Leader = {
  code: string
  name: string
  close: number
  changePct: number
  netVol: number
  estNetValueIdr: number
}
type Streak = Leader & { days: number; direction: "accumulation" | "distribution" }
type Broker = { firm: string; name: string; volume: number; value: number; freq: number }
type FlowPoint = { date: string; buyVol: number; sellVol: number; netVol: number; netValueIdr: number }
type RotationRow = { sector: string; netValueIdr: number; inflowStocks: number; outflowStocks: number }
type SeriesPoint = { date: string; fbuy: number; fsell: number; net: number; cum: number; close: number }

const fmtIdrB = (v: number) => `${(Math.abs(v) / 1e9).toFixed(2)}M` // miliar IDR
const fmtVol = (v: number) => (Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${(v / 1e3).toFixed(0)}K`)
const signCls = (v: number) => (v >= 0 ? "text-accent-green" : "text-accent-red")

function LeaderTable({ title, rows }: { title: string; rows: Leader[] }) {
  return (
    <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
      <h3 className="text-xs font-semibold text-text-secondary mb-3">{title}</h3>
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="text-text-muted border-b border-border-dim">
            <th className="text-left py-1">Code</th>
            <th className="text-right py-1">Close</th>
            <th className="text-right py-1">Δ%</th>
            <th className="text-right py-1">Net Vol</th>
            <th className="text-right py-1">Est Net (Rp B)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code} className="border-b border-border-dim/30">
              <td className="py-1 font-mono font-semibold text-teal-vivid">{r.code}</td>
              <td className="py-1 text-right">{r.close.toLocaleString("id-ID")}</td>
              <td className={`py-1 text-right ${signCls(r.changePct)}`}>{r.changePct >= 0 ? "+" : ""}{r.changePct.toFixed(2)}</td>
              <td className="py-1 text-right font-mono">{fmtVol(r.netVol)}</td>
              <td className={`py-1 text-right ${signCls(r.estNetValueIdr)}`}>{fmtIdrB(r.estNetValueIdr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Market-wide foreign net-value per session — dependency-free SVG bars. */
function FlowChart({ sessions }: { sessions: FlowPoint[] }) {
  if (sessions.length === 0) return null
  const max = Math.max(...sessions.map((s) => Math.abs(s.netValueIdr)), 1)
  const W = 1000
  const H = 180
  const bw = W / sessions.length
  const mid = H / 2
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
      <line x1={0} y1={mid} x2={W} y2={mid} stroke="var(--border-dim, #333)" strokeWidth={1} />
      {sessions.map((s, i) => {
        const h = (Math.abs(s.netValueIdr) / max) * (mid - 14)
        const up = s.netValueIdr >= 0
        return (
          <rect
            key={s.date}
            x={i * bw + bw * 0.15}
            y={up ? mid - h : mid}
            width={bw * 0.7}
            height={Math.max(h, 1)}
            fill={up ? "var(--accent-green, #22c55e)" : "var(--accent-red, #ef4444)"}
            opacity={0.85}
          >
            <title>{`${s.date} · Rp${fmtIdrB(s.netValueIdr)}B · vol ${fmtVol(s.netVol)}`}</title>
          </rect>
        )
      })}
    </svg>
  )
}

/** Per-stock series: net-volume bars + cumulative line overlay. */
function SeriesChart({ pts }: { pts: SeriesPoint[] }) {
  if (pts.length === 0) return null
  const W = 1000
  const H = 160
  const bw = W / pts.length
  const maxAbsNet = Math.max(...pts.map((p) => Math.abs(p.net)), 1)
  const cums = pts.map((p) => p.cum)
  const cumMin = Math.min(...cums, 0)
  const cumMax = Math.max(...cums, 0)
  const cumRange = Math.max(cumMax - cumMin, 1)
  const mid = H / 2
  // Cumulative polyline mapped into the top half.
  const cumY = (v: number) => 8 + ((cumMax - v) / cumRange) * (mid - 20)
  const poly = pts
    .map((p, i) => `${i * bw + bw / 2},${cumY(p.cum)}`)
    .join(" ")
  const last = pts[pts.length - 1]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <line x1={0} y1={mid} x2={W} y2={mid} stroke="var(--border-dim, #333)" strokeWidth={1} />
      {pts.map((p, i) => {
        const h = (Math.abs(p.net) / maxAbsNet) * (mid - 12)
        const up = p.net >= 0
        return (
          <rect
            key={p.date}
            x={i * bw + bw * 0.2}
            y={up ? mid - h : mid}
            width={Math.max(bw * 0.6, 1)}
            height={Math.max(h, 1)}
            fill={up ? "rgba(34,197,94,0.55)" : "rgba(239,68,68,0.55)"}
          >
            <title>{`${p.date} · net ${fmtVol(p.net)} sh · cum ${fmtVol(p.cum)} · close ${p.close}`}</title>
          </rect>
        )
      })}
      <polyline points={poly} fill="none" stroke="#38bdf8" strokeWidth={2} />
      <circle cx={(pts.length - 1) * bw + bw / 2} cy={cumY(last.cum)} r={3} fill="#38bdf8" />
    </svg>
  )
}

export default function BandarmologyPage() {
  const [tab, setTab] = useState<"leaders" | "streaks" | "brokers" | "flow" | "rotation">("leaders")
  const [meta, setMeta] = useState<{ tradeDate?: string; capturedAt?: string; count?: number }>({})
  const [topBuy, setTopBuy] = useState<Leader[]>([])
  const [topSell, setTopSell] = useState<Leader[]>([])
  const [acc, setAcc] = useState<Streak[]>([])
  const [dist, setDist] = useState<Streak[]>([])
  const [brokers, setBrokers] = useState<Broker[]>([])
  const [flow, setFlow] = useState<FlowPoint[]>([])
  const [rotation, setRotation] = useState<RotationRow[]>([])
  const [symbol, setSymbol] = useState("")
  const [seriesStatus, setSeriesStatus] = useState<string>("")
  const [seriesData, setSeriesData] = useState<{ sym: string; pts: SeriesPoint[] } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        if (tab === "leaders") {
          const d = await (await fetch("/api/v1/saham/bandarmology?view=leaders&limit=25")).json()
          if (!cancelled) {
            setTopBuy(d.data?.topBuy ?? [])
            setTopSell(d.data?.topSell ?? [])
            setMeta(d.data?.meta ?? {})
          }
        } else if (tab === "streaks") {
          const d = await (await fetch("/api/v1/saham/bandarmology?view=streaks&minDays=3&limit=25")).json()
          if (!cancelled) {
            setAcc(d.data?.accumulation ?? [])
            setDist(d.data?.distribution ?? [])
            setMeta(d.data?.meta ?? {})
          }
        } else if (tab === "brokers") {
          const d = await (await fetch("/api/v1/saham/bandarmology?view=brokers&limit=25")).json()
          if (!cancelled) {
            setBrokers(d.data?.rows ?? [])
            setMeta({ tradeDate: d.data?.tradeDate })
          }
        } else if (tab === "flow") {
          const d = await (await fetch("/api/v1/saham/bandarmology?view=flow")).json()
          if (!cancelled) {
            setFlow(d.data?.sessions ?? [])
            setMeta({ tradeDate: d.data?.tradeDate })
          }
        } else {
          const d = await (await fetch("/api/v1/saham/bandarmology?view=rotation")).json()
          if (!cancelled) {
            setRotation(d.data?.sectors ?? [])
            setMeta({ tradeDate: d.data?.tradeDate })
          }
        }
      } catch { /* leave previous */ }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [tab])

  const lookupSeries = () => {
    const sym = symbol.trim().toUpperCase().replace('.JK', '')
    if (!sym) return
    setSeriesStatus(`loading ${sym}…`)
    fetch(`/api/v1/saham/bandarmology?view=series&symbol=${sym}&days=90`)
      .then((r) => r.json())
      .then((d) => {
        const s = d.data?.series as SeriesPoint[] | undefined
        if (!s || s.length === 0) {
          setSeriesData(null)
          setSeriesStatus(`${sym}: no history yet (history builds daily)`)
          return
        }
        setSeriesData({ sym, pts: s })
        setSeriesStatus(`${sym} · last ${s.length} sessions · cum ${fmtVol(s[s.length - 1].cum)} shares`)
      })
      .catch(() => setSeriesStatus(`${sym}: lookup failed`))
  }

  const TABS = [
    ["leaders", "Net Foreign"],
    ["streaks", "Streaks ≥3d"],
    ["brokers", "Broker Board"],
    ["flow", "Market Flow"],
    ["rotation", "Sector Rotation"],
  ] as const

  const maxAbsRot = Math.max(...rotation.map((r) => Math.abs(r.netValueIdr)), 1)

  return (
    <NexusLayout>
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="page-title">BANDARMOLOGY — IDX FOREIGN FLOW</h1>
          <div className="flex items-center gap-3">
            <LiveDot status={loading ? "stale" : "live"} label />
            {meta.tradeDate && (
              <span className="text-[10px] text-text-muted font-mono">
                session {meta.tradeDate} · {meta.count ?? "—"} stocks
                {meta.capturedAt ? ` · captured ${new Date(meta.capturedAt).toLocaleTimeString("id-ID")}` : ""}
              </span>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-2">
          {(TABS as ReadonlyArray<readonly [typeof tab, string]>).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1 text-[10px] font-mono uppercase rounded border transition-colors ${
                tab === t
                  ? "bg-teal-vivid text-bg-base border-teal-vivid font-bold"
                  : "bg-bg-panel border-border-dim text-text-muted hover:border-border-active"
              }`}>
              {label}
            </button>
          ))}
          <div className="flex ml-auto gap-1 items-center">
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && lookupSeries()}
              placeholder="e.g. BBRI"
              className="bg-bg-raised border border-border-dim rounded px-2 py-1 text-[11px] font-mono w-28"
            />
            <button onClick={lookupSeries}
              className="px-3 py-1 text-[10px] font-mono rounded border border-border-dim text-text-muted hover:border-border-active">
              Series
            </button>
          </div>
        </div>

        {seriesStatus && (
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4 space-y-3">
            <p className="text-[11px] font-mono text-text-muted">{seriesStatus}</p>
            {seriesData && seriesData.pts.length > 0 && (
              <>
                <SeriesChart pts={seriesData.pts} />
                <div className="flex justify-between text-[10px] text-text-muted font-mono">
                  <span>{seriesData.pts[0]?.date}</span>
                  <span className="hidden md:inline">bars = daily net foreign vol · line = cumulative</span>
                  <span>{seriesData.pts[seriesData.pts.length - 1]?.date}</span>
                </div>
              </>
            )}
          </div>
        )}

        {tab === "leaders" && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <LeaderTable title={`TOP FOREIGN NET BUY (${(topBuy[0]?.estNetValueIdr ?? 0) > 0 ? "by est value" : ""})`} rows={topBuy} />
            <LeaderTable title="TOP FOREIGN NET SELL" rows={topSell} />
          </div>
        )}

        {tab === "streaks" && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
              <h3 className="text-xs font-semibold text-data-bull mb-3">ACCUMULATION STREAKS</h3>
              <ul className="space-y-1 text-xs font-mono">
                {acc.map((s) => (
                  <li key={s.code} className="flex justify-between border-b border-border-dim/30 py-1">
                    <span><span className="font-bold">{s.code}</span><span className="text-text-muted ml-2 hidden md:inline">{s.name.slice(0, 24)}</span></span>
                    <span className="text-accent-green">{s.days}d · Rp{fmtIdrB(s.estNetValueIdr)}B</span>
                  </li>
                ))}
                {acc.length === 0 && !loading && <li className="text-text-muted">no streaks ≥3d yet (history builds daily)</li>}
              </ul>
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
              <h3 className="text-xs font-semibold text-data-bear mb-3">DISTRIBUTION STREAKS</h3>
              <ul className="space-y-1 text-xs font-mono">
                {dist.map((s) => (
                  <li key={s.code} className="flex justify-between border-b border-border-dim/30 py-1">
                    <span><span className="font-bold">{s.code}</span><span className="text-text-muted ml-2 hidden md:inline">{s.name.slice(0, 24)}</span></span>
                    <span className="text-accent-red">{s.days}d · Rp{fmtIdrB(s.estNetValueIdr)}B</span>
                  </li>
                ))}
                {dist.length === 0 && !loading && <li className="text-text-muted">no streaks ≥3d yet (history builds daily)</li>}
              </ul>
            </div>
          </div>
        )}

        {tab === "brokers" && (
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4 overflow-x-auto">
            <h3 className="text-xs font-semibold text-text-secondary mb-3">TOP BROKERS BY TURNOVER</h3>
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-text-muted border-b border-border-dim">
                  <th className="text-left py-1">#</th>
                  <th className="text-left py-1">Firm</th>
                  <th className="text-right py-1">Value (Rp T)</th>
                  <th className="text-right py-1">Volume</th>
                  <th className="text-right py-1">Freq</th>
                </tr>
              </thead>
              <tbody>
                {brokers.map((b, i) => (
                  <tr key={b.firm} className="border-b border-border-dim/30">
                    <td className="py-1 text-text-muted">{i + 1}</td>
                    <td className="py-1"><span className="font-bold mr-2">{b.firm}</span>{b.name}</td>
                    <td className="py-1 text-right">{(b.value / 1e12).toFixed(2)}T</td>
                    <td className="py-1 text-right font-mono">{fmtVol(b.volume)}</td>
                    <td className="py-1 text-right">{b.freq.toLocaleString("id-ID")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "flow" && (
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <div className="flex justify-between items-baseline mb-3">
              <h3 className="text-xs font-mono text-accent-cyan">MARKET-WIDE FOREIGN NET VALUE / SESSION</h3>
              <span className="text-[10px] text-text-muted font-mono">
                latest {flow.length > 0 ? `Rp${fmtIdrB(flow[flow.length - 1].netValueIdr)}B` : "—"}
              </span>
            </div>
            {flow.length === 0 ? (
              <p className="text-text-muted text-xs font-mono">no sessions in history yet</p>
            ) : (
              <>
                <FlowChart sessions={flow} />
                <div className="flex justify-between mt-2 text-[10px] text-text-muted font-mono">
                  <span>{flow[0]?.date}</span>
                  <span>{flow.length} session{flow.length > 1 ? "s" : ""} (history builds nightly toward 90)</span>
                  <span>{flow[flow.length - 1]?.date}</span>
                </div>
              </>
            )}
          </div>
        )}

        {tab === "rotation" && (
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <h3 className="text-xs font-semibold text-text-secondary mb-3">SECTOR ROTATION — FOREIGN NET VALUE (est, Rp B)</h3>
            <div className="space-y-1.5">
              {rotation.map((r) => {
                const pct = (Math.abs(r.netValueIdr) / maxAbsRot) * 50
                const up = r.netValueIdr >= 0
                return (
                  <div key={r.sector} className="flex items-center text-[11px] font-mono gap-2">
                    <span className="w-40 truncate text-text-dim" title={r.sector}>{r.sector}</span>
                    <div className="flex-1 flex items-center h-4 relative">
                      <div className="absolute inset-y-0 left-1/2 w-px bg-border-dim" />
                      <div
                        className={`absolute inset-y-0.5 ${up ? "bg-accent-green/60 left-1/2" : "bg-accent-red/60 right-1/2"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className={`w-24 text-right ${signCls(r.netValueIdr)}`}>
                      {up ? "+" : "−"}{fmtIdrB(r.netValueIdr)}
                    </span>
                    <span className="w-20 text-right text-text-muted hidden md:inline">
                      {r.inflowStocks}↑ {r.outflowStocks}↓
                    </span>
                  </div>
                )
              })}
              {rotation.length === 0 && !loading && (
                <p className="text-text-muted text-xs">no rotation data yet</p>
              )}
            </div>
          </div>
        )}
      </div>
    </NexusLayout>
  )
}
