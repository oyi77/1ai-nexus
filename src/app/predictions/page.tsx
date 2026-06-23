"use client"

import { useState, useEffect, useCallback } from "react"
import { NexusLayout } from "@/components/layout/NexusLayout"
import { Target, TrendingUp, Users, BarChart3, ExternalLink, Filter } from "lucide-react"

interface NormalizedMarket {
  id: string
  question: string
  source: string
  probability: number
  volume24h: number
  totalVolume: number
  liquidity: number
  category: string
  url: string
  active: boolean
  endDate: string | null
  traderCount: number
  outcomes: string[]
}

interface SourceStatus {
  count: number
  status: string
  latencyMs: number
}

interface AggregatedData {
  markets: NormalizedMarket[]
  totalMarkets: number
  sources: Record<string, SourceStatus>
  timestamp: number
}

const SOURCES = ["all", "polymarket", "manifold", "metaculus"] as const
const CATEGORIES = ["all", "crypto", "politics", "economics", "technology", "geopolitics", "sports", "entertainment", "science", "general"] as const
const SORT_OPTIONS = [
  { value: "volume24h", label: "Volume (24h)" },
  { value: "totalVolume", label: "Total Volume" },
  { value: "liquidity", label: "Liquidity" },
  { value: "probability", label: "Probability" },
] as const

export default function PredictionsPage() {
  const [data, setData] = useState<AggregatedData | null>(null)
  const [loading, setLoading] = useState(true)
  const [source, setSource] = useState<string>("all")
  const [category, setCategory] = useState<string>("all")
  const [sort, setSort] = useState<string>("volume24h")
  const [order, setOrder] = useState<string>("desc")

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: "60", sort, order })
      if (source !== "all") params.set("source", source)
      if (category !== "all") params.set("category", category)

      const res = await fetch(`/api/v1/prediction-markets?${params}`)
      const json = await res.json()
      if (json.data) {
        setData(json.data)
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [source, category, sort, order])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return (
    <NexusLayout>
      <div className="h-full overflow-auto p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-mono font-bold text-accent-cyan flex items-center gap-2">
            <Target size={14} /> PREDICTION MARKETS
          </h1>
          <span className="text-[10px] text-text-muted">
            {data?.totalMarkets ?? 0} markets · {data ? Object.keys(data.sources).length : 0} sources
          </span>
        </div>

        {/* Source Health */}
        {data && (
          <div className="flex gap-3 flex-wrap">
            {Object.entries(data.sources).map(([key, src]) => (
              <div
                key={key}
                className="flex items-center gap-1.5 text-[10px] px-2 py-1 rounded border border-border-dim bg-bg-panel"
              >
                <span className={src.status === "ok" ? "text-green-400" : "text-red-400"}>
                  {src.status === "ok" ? "●" : "○"}
                </span>
                <span className="text-text-dim uppercase">{key}</span>
                <span className="text-accent-cyan">{src.count}</span>
                <span className="text-text-muted">{src.latencyMs}ms</span>
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-2 flex-wrap items-center">
          <Filter size={12} className="text-text-muted" />
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="text-[10px] bg-bg-panel border border-border-dim rounded px-2 py-1 text-text-primary"
          >
            {SOURCES.map((s) => (
              <option key={s} value={s}>{s === "all" ? "All Sources" : s}</option>
            ))}
          </select>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="text-[10px] bg-bg-panel border border-border-dim rounded px-2 py-1 text-text-primary"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c === "all" ? "All Categories" : c}</option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="text-[10px] bg-bg-panel border border-border-dim rounded px-2 py-1 text-text-primary"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            onClick={() => setOrder(order === "desc" ? "asc" : "desc")}
            className="text-[10px] bg-bg-panel border border-border-dim rounded px-2 py-1 text-text-primary hover:border-border-active transition-colors"
          >
            {order === "desc" ? "↓" : "↑"}
          </button>
        </div>

        {/* Market Grid */}
        {loading ? (
          <div className="text-center py-20 text-text-dim text-xs">
            Aggregating prediction markets...
          </div>
        ) : !data || data.markets.length === 0 ? (
          <div className="text-center py-20 text-text-dim text-xs">
            No prediction markets available
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.markets.map((m) => (
              <MarketCard key={m.id} market={m} />
            ))}
          </div>
        )}
      </div>
    </NexusLayout>
  )
}

function MarketCard({ market }: { market: NormalizedMarket }) {
  const prob = Math.round(market.probability * 100)
  const probColor = prob >= 70 ? "text-green-400" : prob >= 30 ? "text-yellow-400" : "text-red-400"
  const sourceBadge = SOURCE_COLORS[market.source] ?? "bg-gray-500/20 text-gray-400"

  return (
    <a
      href={market.url}
      target="_blank"
      rel="noopener noreferrer"
      className="bg-bg-panel border border-border-dim rounded-lg p-3 hover:border-border-active transition-colors group"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-xs text-text-primary leading-tight line-clamp-2 flex-1">
          {market.question}
        </p>
        <ExternalLink size={10} className="text-text-muted group-hover:text-accent-cyan flex-shrink-0 mt-0.5" />
      </div>

      {/* Probability Bar */}
      <div className="mb-2">
        <div className="flex items-center justify-between mb-1">
          <span className={`text-sm font-mono font-bold ${probColor}`}>{prob}%</span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded ${sourceBadge}`}>
            {market.source}
          </span>
        </div>
        <div className="w-full h-1.5 bg-bg-elevated rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${prob}%`,
              backgroundColor: prob >= 70 ? "#4ade80" : prob >= 30 ? "#facc15" : "#f87171",
            }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center justify-between text-[10px]">
        <div className="flex items-center gap-1 text-text-dim">
          <BarChart3 size={10} />
          <span>${formatNum(market.volume24h)}</span>
        </div>
        {market.liquidity > 0 && (
          <div className="flex items-center gap-1 text-text-dim">
            <TrendingUp size={10} />
            <span>${formatNum(market.liquidity)}</span>
          </div>
        )}
        {market.traderCount > 0 && (
          <div className="flex items-center gap-1 text-text-dim">
            <Users size={10} />
            <span>{formatNum(market.traderCount)}</span>
          </div>
        )}
        <span className="text-text-muted capitalize">{market.category}</span>
      </div>
    </a>
  )
}

const SOURCE_COLORS: Record<string, string> = {
  polymarket: "bg-blue-500/20 text-blue-400",
  manifold: "bg-purple-500/20 text-purple-400",
  metaculus: "bg-emerald-500/20 text-emerald-400",
}

function formatNum(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`
  return n.toLocaleString()
}
