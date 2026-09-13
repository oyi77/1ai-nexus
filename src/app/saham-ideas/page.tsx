"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { NexusLayout } from "@/components/layout/NexusLayout"
import { LiveDot } from "@/components/primitives/LiveDot"
import Link from "next/link"

interface Idea {
  code: string; name: string; sector: string; close: number; changePct: number
  per: number | null; pbv: number | null; roe: number | null; der: number | null
  dividendYield: number | null; marketCap: number | null
  foreignNetStreakDays: number; foreignNetStreakDir: "accumulation" | "distribution" | null
  estNetValueIdr: number; valueScore: number; accumulationScore: number; combinedScore: number
  alphaScore: number; alphaVerdict: string; alphaReasons: string[]
  tradePlan: {
    entry: number; stop: number; stopPct: number; riskPerShare: number
    targets: Array<{ level: number; pct: number; rMultiple: number }>
    riskReward: number
    sizing: { shares: number; lots: number; allocation: number; allocationPct: number; riskAmount: number } | null
    warnings: string[]
  }
}

interface Response {
  tradeDate: string; screenerDate: string; fundamentalsDate: string
  sessionDates: number; count: number; ideas: Idea[]
}

interface TrackStats {
  total: number; evaluated: number; overallWinRate: number
  avgReturn7d: number; avgReturn14d: number; avgReturn30d: number
  byVerdict: Array<{ verdict: string; winRate: number; count: number }>
  bySector: Array<{ sector: string; winRate: number; count: number }>
  recent: unknown[]
}

const SCORE_BADGE: Record<number, string> = {
  5: "bg-accent-green/20 text-accent-green",
  4: "bg-accent-green/10 text-accent-green",
  3: "bg-accent-yellow/10 text-accent-yellow",
  2: "bg-accent-orange/10 text-accent-orange",
  1: "bg-accent-red/10 text-accent-red",
}

const VERDICT_CLS: Record<string, string> = {
  "strong-buy": "text-accent-green font-semibold",
  "buy": "text-accent-green",
  "hold": "text-text-secondary",
  "avoid": "text-accent-red",
}

function SortHeader({
  field,
  label,
  sortField,
  sortDir,
  onSort,
}: {
  field: keyof Idea
  label: string
  sortField: keyof Idea
  sortDir: "asc" | "desc"
  onSort: (field: keyof Idea) => void
}) {
  return (
    <th className="px-3 py-2 text-left text-xs font-medium text-text-tertiary uppercase tracking-wide cursor-pointer hover:text-text-secondary select-none" onClick={() => onSort(field)}>
      {label} {sortField === field && (sortDir === "desc" ? "↓" : "↑")}
    </th>
  )
}

const fmtIdr = (v: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(v)

export default function SahamIdeasPage() {
  const [data, setData] = useState<Response | null>(null)
  const [loading, setLoading] = useState(true)
  const [minScore, setMinScore] = useState(1)
  const [sector, setSector] = useState("All")
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<Idea | null>(null)
  const [sortField, setSortField] = useState<keyof Idea>("alphaScore")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [capital, setCapital] = useState<number>(10_000_000)
  const [capitalInput, setCapitalInput] = useState<string>("10000000")

  const [trackStats, setTrackStats] = useState<TrackStats | null>(null)

  useEffect(() => {
    fetch("/api/v1/saham/track-record")
      .then((r) => r.json())
      .then((d) => setTrackStats(d.data))
      .catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    // setState in async callbacks (not synchronously in the effect body) —
    // the linter flags sync setState as a cascading-render hazard.
    fetch(`/api/v1/saham/watchlist-ideas?limit=200&capital=${capital}&riskPct=0.01`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) { setData(d.data); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [capital])

  const handleSort = useCallback((field: keyof Idea) => {
    if (sortField === field) setSortDir(d => (d === "desc" ? "asc" : "desc"))
    else { setSortField(field); setSortDir("desc") }
  }, [sortField])

  const sectors = useMemo(() => {
    if (!data) return []
    return [...new Set(data.ideas.map((i) => i.sector))].sort()
  }, [data])

  const filtered = useMemo(() => {
    if (!data) return []
    let ideas = data.ideas.filter((i) => i.valueScore >= minScore)
    if (sector !== "All") ideas = ideas.filter((i) => i.sector === sector)
    if (search) {
      const q = search.toLowerCase()
      ideas = ideas.filter((i) => i.code.toLowerCase().includes(q) || i.name.toLowerCase().includes(q) || i.sector.toLowerCase().includes(q))
    }
    ideas.sort((a, b) => {
      const av = a[sortField] ?? 0, bv = b[sortField] ?? 0
      if (typeof av === "string" && typeof bv === "string") return sortDir === "desc" ? bv.localeCompare(av) : av.localeCompare(bv)
      return sortDir === "desc" ? (bv as number) - (av as number) : (av as number) - (bv as number)
    })
    return ideas
  }, [data, minScore, sector, search, sortField, sortDir])

  const applyCapital = useCallback(() => {
    const v = Number(capitalInput.replace(/[^0-9]/g, ""))
    if (v > 0) setCapital(v)
  }, [capitalInput])

  return (
    <NexusLayout>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 pt-6 pb-4 border-b border-border-dim">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2">
                <LiveDot status="live" /> IDX Watchlist Ideas
              </h1>
              <p className="text-sm text-text-secondary mt-1">
                Alpha + value + accumulation · {data?.count ?? 0} ideas
                {data?.tradeDate && <span className="text-text-tertiary"> · {data.tradeDate}</span>}
              </p>
            </div>
            <Link href="/bandarmology" className="text-sm text-accent-blue hover:text-accent-blue/80">Bandarmology →</Link>
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-4">
            <input type="text" placeholder="Search code, name, sector..." value={search} onChange={(e) => setSearch(e.target.value)} className="bg-bg-panel border border-border-dim rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-blue w-64" />
            <select value={sector} onChange={(e) => setSector(e.target.value)} className="bg-bg-panel border border-border-dim rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent-blue">
              <option value="All">All Sectors</option>
              {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-tertiary">Min value:</span>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => setMinScore(n)} className={`w-7 h-7 rounded text-xs font-medium ${minScore === n ? "bg-accent-blue text-white" : "bg-bg-panel border border-border-dim text-text-secondary hover:border-accent-blue"}`}>{n}</button>
              ))}
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-xs text-text-tertiary">Capital:</span>
              <input
                type="text"
                value={capitalInput}
                onChange={(e) => setCapitalInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") applyCapital() }}
                onBlur={applyCapital}
                placeholder="10000000"
                className="bg-bg-panel border border-border-dim rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-blue w-32 tabular-nums"
              />
              <span className="text-xs text-text-tertiary">risk 1%/trade</span>
            </div>
          </div>
        </div>
        {/* Track record proof */}
        {trackStats && trackStats.total > 0 && (
          <div className="px-6 py-3 border-b border-border-dim bg-bg-panel/30 flex items-center gap-6 text-xs flex-wrap">
            <span className="text-text-tertiary">Track Record:</span>
            <span className="text-text-secondary">{trackStats.evaluated} signals evaluated</span>
            <span className="text-text-secondary">Win rate: <span className={trackStats.overallWinRate >= 50 ? "text-accent-green" : "text-accent-red"}>{trackStats.overallWinRate.toFixed(0)}%</span></span>
            <span className="text-text-secondary">Avg 7d: <span className={trackStats.avgReturn7d >= 0 ? "text-accent-green" : "text-accent-red"}>{trackStats.avgReturn7d.toFixed(2)}%</span></span>
            <span className="text-text-secondary">Avg 30d: <span className={trackStats.avgReturn30d >= 0 ? "text-accent-green" : "text-accent-red"}>{trackStats.avgReturn30d.toFixed(2)}%</span></span>
            {trackStats.byVerdict.map((v) => (
              <span key={v.verdict} className="text-text-tertiary">{v.verdict}: {v.winRate.toFixed(0)}% ({v.count})</span>
            ))}
          </div>
        )}


        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-64 text-text-tertiary">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-text-tertiary">No ideas match filters.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-bg-panel border-b border-border-dim z-10">
                <tr>
                  <SortHeader field="code" label="Code" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortHeader field="name" label="Name" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortHeader field="sector" label="Sector" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortHeader field="alphaScore" label="Alpha" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortHeader field="per" label="PER" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortHeader field="pbv" label="PBV" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortHeader field="roe" label="ROE%" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortHeader field="dividendYield" label="Yield%" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortHeader field="valueScore" label="Value" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortHeader field="accumulationScore" label="Accum" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortHeader field="combinedScore" label="Score" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => (
                  <tr key={i.code} className={`border-b border-border-dim/50 hover:bg-bg-panel/50 transition-colors cursor-pointer ${selected?.code === i.code ? "bg-bg-panel/80" : ""}`} onClick={() => setSelected(selected?.code === i.code ? null : i)}>
                    <td className="px-3 py-2.5 font-mono font-medium text-text-primary">{i.code}</td>
                    <td className="px-3 py-2.5 text-text-secondary max-w-[180px] truncate">{i.name}</td>
                    <td className="px-3 py-2.5 text-text-tertiary text-xs">{i.sector}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 ${VERDICT_CLS[i.alphaVerdict] || "text-text-secondary"}`}>
                        <span className={`w-2 h-2 rounded-full ${i.alphaVerdict === "strong-buy" ? "bg-accent-green" : i.alphaVerdict === "buy" ? "bg-accent-green/60" : i.alphaVerdict === "avoid" ? "bg-accent-red" : "bg-bg-sunken"}`} />
                        {i.alphaScore}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-text-secondary tabular-nums">{i.per?.toFixed(2) ?? "—"}</td>
                    <td className="px-3 py-2.5 text-text-secondary tabular-nums">{i.pbv?.toFixed(2) ?? "—"}</td>
                    <td className="px-3 py-2.5 text-text-secondary tabular-nums">{i.roe?.toFixed(1) ?? "—"}</td>
                    <td className="px-3 py-2.5 text-text-secondary tabular-nums">{i.dividendYield?.toFixed(1) ?? "—"}</td>
                    <td className="px-3 py-2.5"><span className={`inline-flex items-center justify-center w-6 h-6 rounded text-xs font-medium ${SCORE_BADGE[i.valueScore] ?? "bg-bg-panel text-text-tertiary"}`}>{i.valueScore}</span></td>
                    <td className="px-3 py-2.5">{i.accumulationScore > 0 ? <span className="text-accent-green text-xs">↑{i.accumulationScore}</span> : <span className="text-text-tertiary">—</span>}</td>
                    <td className="px-3 py-2.5"><span className="font-semibold text-text-primary tabular-nums">{i.combinedScore.toFixed(1)}</span></td>
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
                <span className="font-mono font-semibold text-text-primary">{selected.code}</span>
                <span className="text-text-secondary text-sm">{selected.name}</span>
                <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${VERDICT_CLS[selected.alphaVerdict] || "text-text-secondary"}`}>
                  <span className={`w-2 h-2 rounded-full ${selected.alphaVerdict === "strong-buy" ? "bg-accent-green" : selected.alphaVerdict === "buy" ? "bg-accent-green/60" : selected.alphaVerdict === "avoid" ? "bg-accent-red" : "bg-bg-sunken"}`} />
                  Alpha {selected.alphaScore} · {selected.alphaVerdict}
                </span>
              </div>
              <button onClick={() => setSelected(null)} className="text-text-tertiary hover:text-text-primary text-sm">✕</button>
            </div>
            {selected.alphaReasons.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {selected.alphaReasons.map((r, idx) => (
                  <span key={idx} className="inline-flex items-center gap-1 bg-bg-sunken rounded-full px-3 py-1 text-xs text-text-secondary">{r}</span>
                ))}
              </div>
            )}
            {/* Trade plan */}
            {selected.tradePlan && selected.tradePlan.entry > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-bg-sunken rounded-lg p-3">
                  <div className="text-[10px] uppercase tracking-wide text-text-tertiary mb-1">Entry (close)</div>
                  <div className="text-text-primary font-mono tabular-nums">{fmtIdr(selected.tradePlan.entry)}</div>
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
                    <div className="text-text-tertiary text-xs">Set capital above to size</div>
                  </div>
                )}
              </div>
            )}
            {selected.tradePlan?.warnings && selected.tradePlan.warnings.length > 0 && (
              <div className="mt-2 text-xs text-data-warn">{selected.tradePlan.warnings.join(" · ")}</div>
            )}
            <p className="mt-3 text-[10px] text-text-tertiary">Educational idea, not financial advice. Stop/targets derived from ATR + swing low; sizing assumes 1% capital risk per trade.</p>
          </div>
        )}
      </div>
    </NexusLayout>
  )
}
