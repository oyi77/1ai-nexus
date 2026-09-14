"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { NexusLayout } from "@/components/layout/NexusLayout"
import { LiveDot } from "@/components/primitives/LiveDot"
import Link from "next/link"

interface TradePlan {
  entry: number
  stop: number
  stopPct: number
  targets: Array<{ level: number; pct: number; rMultiple: number }>
  sizing: { shares: number; lots: number; allocation: number; allocationPct: number; riskAmount: number } | null
}

interface Candidate {
  leg: string; asset: string; direction: string
  gainPct: number; horizonHrs: number; hitRate: number; confidence: number
  reason: string; expectedHourly?: number
  score?: number
  tradePlan?: TradePlan
  livePrice?: number
  chasePct?: number
  chaseFlag?: string
}

interface LegSummary {
  leg: string; candidates: number; passed: number; hitRate: number | null
}

interface Board {
  updatedAt: string; gate: number; limit: number
  board: Candidate[]; legs: LegSummary[]
  proof: { idxN: number; backtestSources: number; lrfgN: number }
}

const LEG_CLS: Record<string, string> = {
  idx: "text-accent-green",
  crypto: "text-accent-blue",
  lrfg: "text-data-warn",
  launch: "text-accent-purple",
  copy: "text-text-secondary",
  predict: "text-text-tertiary",
}

const CHASE_CLS: Record<string, string> = {
  ok: "text-accent-green",
  warm: "text-data-warn",
  chase: "text-accent-red",
  stale: "text-text-tertiary",
}

const CHASE_LABEL: Record<string, string> = {
  ok: "entry valid",
  warm: "warming up",
  chase: "CHASE RISK",
  stale: "no live quote",
}

function SortHeader({
  field,
  label,
  sortField,
  sortDir,
  onSort,
}: {
  field: keyof Candidate
  label: string
  sortField: keyof Candidate
  sortDir: "asc" | "desc"
  onSort: (f: keyof Candidate) => void
}) {
  return (
    <th
      className="px-3 py-2 text-left text-xs font-medium text-text-tertiary uppercase tracking-wide cursor-pointer hover:text-text-primary select-none"
      onClick={() => onSort(field)}
    >
      {label} {sortField === field ? (sortDir === "desc" ? "↓" : "↑") : ""}
    </th>
  )
}

function fmtHorizon(hrs: number): string {
  if (hrs < 24) return `${hrs}h`
  const d = Math.round(hrs / 24)
  return d >= 30 ? `${Math.round(d / 30)}mo` : `${d}d`
}

const fmtIdr = (v: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(v)

export default function MoonshotPage() {
  const [data, setData] = useState<Board | null>(null)
  const [loading, setLoading] = useState(true)
  const [leg, setLeg] = useState("All")
  const [selected, setSelected] = useState<Candidate | null>(null)
  const [sortField, setSortField] = useState<keyof Candidate>("expectedHourly")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  useEffect(() => {
    let cancelled = false
    // setState in async callbacks (not synchronously in the effect body) —
    // the linter flags sync setState as a cascading-render hazard.
    fetch("/api/v1/saham/moonshot")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) { setData(d.data); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const handleSort = useCallback((field: keyof Candidate) => {
    if (sortField === field) setSortDir(d => (d === "desc" ? "asc" : "desc"))
    else { setSortField(field); setSortDir("desc") }
  }, [sortField])

  const filtered = useMemo(() => {
    if (!data) return []
    let rows = data.board
    if (leg !== "All") rows = rows.filter((c) => c.leg === leg)
    rows = [...rows].sort((a, b) => {
      const av = a[sortField] ?? 0, bv = b[sortField] ?? 0
      if (typeof av === "string" && typeof bv === "string") return sortDir === "desc" ? bv.localeCompare(av) : av.localeCompare(bv)
      return sortDir === "desc" ? (bv as number) - (av as number) : (av as number) - (bv as number)
    })
    return rows
  }, [data, leg, sortField, sortDir])

  const warmingLegs = useMemo(() => {
    if (!data) return []
    return data.legs.filter((l) => l.passed === 0).map((l) => l.leg)
  }, [data])

  return (
    <NexusLayout>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 pt-6 pb-4 border-b border-border-dim">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2">
                <LiveDot status="live" /> Moonshot Board
              </h1>
              <p className="text-sm text-text-secondary mt-1">
                Cross-instrument runners · confidence ≥ {data?.gate ?? 70} · top {data?.limit ?? 10}
                {data?.updatedAt && <span className="text-text-tertiary"> · {new Date(data.updatedAt).toLocaleString("id-ID")}</span>}
              </p>
            </div>
            <Link href="/saham-ideas" className="text-sm text-accent-blue hover:text-accent-blue/80">Watchlist Ideas →</Link>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-4">
            {["All", "idx", "crypto", "lrfg", "launch", "copy", "predict"].map((l) => (
              <button key={l} onClick={() => setLeg(l)} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${leg === l ? "bg-accent-blue text-white" : "bg-bg-panel border border-border-dim text-text-secondary hover:border-accent-blue"}`}>{l}</button>
            ))}
          </div>
        </div>
        {/* Proof bar */}
        {data && (
          <div className="px-6 py-3 border-b border-border-dim bg-bg-panel/30 flex items-center gap-6 text-xs flex-wrap">
            <span className="text-text-tertiary">Proof:</span>
            <span className="text-text-secondary">IDX rows: {data.proof.idxN.toLocaleString()}</span>
            <span className="text-text-secondary">Backtest sources: {data.proof.backtestSources}</span>
            <span className="text-text-secondary">LRFg outcomes: {data.proof.lrfgN}</span>
            {data.legs.map((l) => (
              <span key={l.leg} className="text-text-tertiary">{l.leg}: {l.passed}/{l.candidates}{l.hitRate != null ? ` · hit ${l.hitRate.toFixed(0)}%` : ""}</span>
            ))}
          </div>
        )}
        {warmingLegs.length > 0 && (
          <div className="px-6 py-2 border-b border-border-dim text-xs text-text-tertiary">
            Warming up (no qualified candidates yet): {warmingLegs.join(" · ")} — legs join the board once their setups earn measured history.
          </div>
        )}

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-64 text-text-tertiary">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-text-tertiary">No candidates pass the confidence gate.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-bg-panel border-b border-border-dim z-10">
                <tr>
                  <SortHeader field="leg" label="Leg" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortHeader field="asset" label="Asset" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortHeader field="score" label="Score" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortHeader field="gainPct" label="Gain%" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortHeader field="horizonHrs" label="Horizon" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortHeader field="hitRate" label="Hit%" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortHeader field="confidence" label="Conf" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortHeader field="chasePct" label="vs Entry" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={`${c.leg}:${c.asset}`} className={`border-b border-border-dim/50 hover:bg-bg-panel/50 transition-colors cursor-pointer ${selected?.asset === c.asset && selected?.leg === c.leg ? "bg-bg-panel/80" : ""}`} onClick={() => setSelected(selected?.asset === c.asset && selected?.leg === c.leg ? null : c)}>
                    <td className={`px-3 py-2.5 font-medium ${LEG_CLS[c.leg] || "text-text-secondary"}`}>{c.leg}</td>
                    <td className="px-3 py-2.5 font-mono font-medium text-text-primary max-w-[220px] truncate">{c.asset}</td>
                    <td className="px-3 py-2.5 text-text-secondary tabular-nums">{c.score ?? "—"}</td>
                    <td className="px-3 py-2.5 text-accent-green tabular-nums">+{c.gainPct.toFixed(1)}%</td>
                    <td className="px-3 py-2.5 text-text-secondary tabular-nums">{fmtHorizon(c.horizonHrs)}</td>
                    <td className="px-3 py-2.5 text-text-secondary tabular-nums">{c.hitRate.toFixed(1)}%</td>
                    <td className="px-3 py-2.5"><span className="font-semibold text-text-primary tabular-nums">{c.confidence.toFixed(1)}</span></td>
                    <td className={`px-3 py-2.5 tabular-nums ${c.chaseFlag ? CHASE_CLS[c.chaseFlag] || "text-text-tertiary" : "text-text-tertiary"}`}>
                      {c.chasePct != null ? `${c.chasePct > 0 ? "+" : ""}${c.chasePct.toFixed(1)}%` : "—"}
                      {c.chaseFlag && c.chaseFlag !== "ok" && <span className="ml-1 text-[10px] uppercase">{CHASE_LABEL[c.chaseFlag] || c.chaseFlag}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selected && (
          <div className="border-t border-border-dim bg-bg-panel/50 px-6 py-4 overflow-auto max-h-[45vh]">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <span className={`text-xs font-medium uppercase ${LEG_CLS[selected.leg] || "text-text-secondary"}`}>{selected.leg}</span>
                <span className="font-mono font-semibold text-text-primary">{selected.asset}</span>
                <span className="text-sm text-text-secondary">+{selected.gainPct.toFixed(1)}% in {fmtHorizon(selected.horizonHrs)} · hit {selected.hitRate.toFixed(1)}% · conf {selected.confidence.toFixed(1)}</span>
              </div>
              <button onClick={() => setSelected(null)} className="text-text-tertiary hover:text-text-primary text-sm">✕</button>
            </div>
            <p className="text-sm text-text-secondary mb-3">{selected.reason}</p>
            {selected.tradePlan && selected.tradePlan.entry > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-bg-sunken rounded-lg p-3">
                  <div className="text-[10px] uppercase tracking-wide text-text-tertiary mb-1">Entry (close)</div>
                  <div className="text-text-primary font-mono tabular-nums">{fmtIdr(selected.tradePlan.entry)}</div>
                  {selected.livePrice != null && selected.livePrice > 0 && (
                    <div className="text-xs text-text-secondary font-mono tabular-nums mt-1">live {fmtIdr(selected.livePrice)}</div>
                  )}
                </div>
                <div className="bg-bg-sunken rounded-lg p-3">
                  <div className="text-[10px] uppercase tracking-wide text-text-tertiary mb-1">Stop Loss (−{selected.tradePlan.stopPct}%)</div>
                  <div className="text-accent-red font-mono tabular-nums">{fmtIdr(selected.tradePlan.stop)}</div>
                </div>
                <div className="bg-bg-sunken rounded-lg p-3">
                  <div className="text-[10px] uppercase tracking-wide text-text-tertiary mb-1">Targets (1R/2R/3R)</div>
                  <div className="text-accent-green font-mono tabular-nums text-xs space-y-0.5">
                    {selected.tradePlan.targets.map((t) => (
                      <div key={t.rMultiple}>{t.rMultiple}R {fmtIdr(t.level)} <span className="text-text-tertiary">(+{t.pct}%)</span></div>
                    ))}
                  </div>
                </div>
                {selected.tradePlan.sizing ? (
                  <div className="bg-bg-sunken rounded-lg p-3">
                    <div className="text-[10px] uppercase tracking-wide text-text-tertiary mb-1">Position Size (risk 1%)</div>
                    <div className="text-text-primary font-mono tabular-nums text-xs space-y-0.5">
                      <div>{selected.tradePlan.sizing.shares.toLocaleString("id-ID")} shares <span className="text-text-tertiary">({selected.tradePlan.sizing.lots} lot)</span></div>
                      <div className="text-text-secondary">{fmtIdr(selected.tradePlan.sizing.allocation)} <span className="text-text-tertiary">({selected.tradePlan.sizing.allocationPct}% of capital)</span></div>
                      <div className="text-accent-red">max risk {fmtIdr(selected.tradePlan.sizing.riskAmount)}</div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-bg-sunken rounded-lg p-3">
                    <div className="text-[10px] uppercase tracking-wide text-text-tertiary mb-1">Position Size</div>
                    <div className="text-text-tertiary text-xs">Default capital Rp10jt</div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-text-tertiary">No executable plan for this leg yet — IDX candidates carry entry/stop/targets.</p>
            )}
            <p className="mt-3 text-[10px] text-text-tertiary">Educational idea, not financial advice. Confidence = measured hit-rate of this setup (P(+10% in 30d) for IDX, backtest win-rate per source for crypto). Only setups with proven history pass the gate.</p>
          </div>
        )}
      </div>
    </NexusLayout>
  )
}
