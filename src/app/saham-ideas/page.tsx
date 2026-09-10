"use client"

import { useState, useEffect, useMemo } from "react"
import { NexusLayout } from "@/components/layout/NexusLayout"
import { LiveDot } from "@/components/primitives/LiveDot"
import Link from "next/link"

interface Idea {
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
  marketCap: number | null
  foreignNetStreakDays: number
  foreignNetStreakDir: "accumulation" | "distribution" | null
  estNetValueIdr: number
  valueScore: number
  accumulationScore: number
  combinedScore: number
}

interface Response {
  tradeDate: string
  screenerDate: string
  fundamentalsDate: string
  sessionDates: number
  count: number
  ideas: Idea[]
}

const fmtTril = (n: number | null) => {
  if (n == null) return "—"
  if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(2)}T`
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  return `${(n / 1e6).toFixed(0)}M`
}

const signCls = (v: number) => (v >= 0 ? "text-accent-green" : "text-accent-red")

const SCORE_BADGE: Record<number, string> = {
  5: "bg-accent-green/20 text-accent-green",
  4: "bg-accent-green/10 text-accent-green",
  3: "bg-accent-yellow/10 text-accent-yellow",
  2: "bg-accent-orange/10 text-accent-orange",
  1: "bg-accent-red/10 text-accent-red",
}

export default function SahamIdeasPage() {
  const [data, setData] = useState<Response | null>(null)
  const [loading, setLoading] = useState(true)
  const [minScore, setMinScore] = useState(1)
  const [sector, setSector] = useState("All")
  const [search, setSearch] = useState("")
  const [sortField, setSortField] = useState<keyof Idea>("combinedScore")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  useEffect(() => {
    fetch("/api/v1/saham/watchlist-ideas?limit=200")
      .then((r) => r.json())
      .then((d) => {
        setData(d.data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

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
      ideas = ideas.filter(
        (i) =>
          i.code.toLowerCase().includes(q) ||
          i.name.toLowerCase().includes(q) ||
          i.sector.toLowerCase().includes(q)
      )
    }
    ideas.sort((a, b) => {
      const av = a[sortField] ?? 0
      const bv = b[sortField] ?? 0
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "desc" ? bv.localeCompare(av) : av.localeCompare(bv)
      }
      return sortDir === "desc" ? (bv as number) - (av as number) : (av as number) - (bv as number)
    })
    return ideas
  }, [data, minScore, sector, search, sortField, sortDir])

  const handleSort = (field: keyof Idea) => {
    if (sortField === field) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"))
    } else {
      setSortField(field)
      setSortDir("desc")
    }
  }

  const SortHeader = ({ field, label }: { field: keyof Idea; label: string }) => (
    <th
      className="px-3 py-2 text-left text-xs font-medium text-text-tertiary uppercase tracking-wider cursor-pointer hover:text-text-primary transition-colors"
      onClick={() => handleSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortField === field && (
          <span className="text-accent-blue">{sortDir === "desc" ? "↓" : "↑"}</span>
        )}
      </span>
    </th>
  )

  return (
    <NexusLayout>
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-border-dim">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2">
                <LiveDot /> IDX Watchlist Ideas
              </h1>
              <p className="text-sm text-text-secondary mt-1">
                Value + accumulation screen · {data?.count ?? 0} ideas
                {data?.tradeDate && <span className="text-text-tertiary"> · {data.tradeDate}</span>}
              </p>
            </div>
            <Link
              href="/bandarmology"
              className="text-sm text-accent-blue hover:text-accent-blue/80 transition-colors"
            >
              Bandarmology →
            </Link>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3 mt-4">
            <input
              type="text"
              placeholder="Search code, name, sector..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-bg-panel border border-border-dim rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-blue w-64"
            />
            <select
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              className="bg-bg-panel border border-border-dim rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
            >
              <option value="All">All Sectors</option>
              {sectors.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-tertiary">Min value score:</span>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setMinScore(n)}
                  className={`w-7 h-7 rounded text-xs font-medium transition-colors ${
                    minScore === n
                      ? "bg-accent-blue text-white"
                      : "bg-bg-panel border border-border-dim text-text-secondary hover:border-accent-blue"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-64 text-text-tertiary">
              Loading ideas...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-text-tertiary">
              No ideas match the current filters.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-bg-panel border-b border-border-dim z-10">
                <tr>
                  <SortHeader field="code" label="Code" />
                  <SortHeader field="name" label="Name" />
                  <SortHeader field="sector" label="Sector" />
                  <SortHeader field="per" label="PER" />
                  <SortHeader field="pbv" label="PBV" />
                  <SortHeader field="roe" label="ROE%" />
                  <SortHeader field="der" label="DER" />
                  <SortHeader field="dividendYield" label="Yield%" />
                  <SortHeader field="marketCap" label="MCap" />
                  <SortHeader field="valueScore" label="Value" />
                  <SortHeader field="accumulationScore" label="Accum" />
                  <SortHeader field="combinedScore" label="Score" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => (
                  <tr
                    key={i.code}
                    className="border-b border-border-dim/50 hover:bg-bg-panel/50 transition-colors"
                  >
                    <td className="px-3 py-2.5 font-mono font-medium text-text-primary">
                      {i.code}
                    </td>
                    <td className="px-3 py-2.5 text-text-secondary max-w-[200px] truncate">
                      {i.name}
                    </td>
                    <td className="px-3 py-2.5 text-text-tertiary text-xs">
                      {i.sector}
                    </td>
                    <td className="px-3 py-2.5 text-text-secondary tabular-nums">
                      {i.per?.toFixed(2) ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-text-secondary tabular-nums">
                      {i.pbv?.toFixed(2) ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-text-secondary tabular-nums">
                      {i.roe?.toFixed(1) ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-text-secondary tabular-nums">
                      {i.der?.toFixed(2) ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-text-secondary tabular-nums">
                      {i.dividendYield?.toFixed(1) ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-text-secondary tabular-nums">
                      {fmtTril(i.marketCap)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded text-xs font-medium ${SCORE_BADGE[i.valueScore] ?? "bg-bg-panel text-text-tertiary"}`}>
                        {i.valueScore}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {i.accumulationScore > 0 ? (
                        <span className="inline-flex items-center gap-1 text-accent-green text-xs">
                          ↑{i.accumulationScore}
                        </span>
                      ) : (
                        <span className="text-text-tertiary">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="font-semibold text-text-primary tabular-nums">
                        {i.combinedScore.toFixed(1)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </NexusLayout>
  )
}
