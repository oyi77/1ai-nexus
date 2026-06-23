"use client"

import { useState, useEffect, useCallback } from "react"
import { NexusLayout } from "@/components/layout/NexusLayout"
import { Panel } from "@/components/shell/Panel"
import { Target, TrendingUp, TrendingDown, X, Plus, Check, Trophy, BarChart3 } from "lucide-react"

interface Market {
  id: string
  category: string
  symbol: string
  status: string
  volume24h: number
  totalVolume: number
  traderCount: number
  outcome?: string
}

interface PaperTrade {
  id: string
  marketId: string
  direction: string
  shares: number
  entryPrice: number
  exitPrice?: number
  resolvedPrice?: number
  outcome?: string
  status: string
  pnl: number
  notes?: string
  closedAt?: string
  createdAt: string
  market: Market
}

interface PortfolioStats {
  totalTrades: number
  openTrades: number
  closedTrades: number
  wins: number
  losses: number
  winRate: number
  totalPnl: number
  unrealizedPnl: number
  avgPnl: number
  bestTrade: number
  worstTrade: number
  capitalDeployed: number
  directionBreakdown: {
    yes: { count: number; pnl: number }
    no: { count: number; pnl: number }
  }
  categoryBreakdown: Record<string, { count: number; pnl: number }>
  recentOpen: PaperTrade[]
  recentClosed: PaperTrade[]
}

type Tab = "positions" | "trade" | "history"

const fmtUsd = (n: number): string => {
  const abs = Math.abs(n)
  if (abs >= 1e6) return `${n < 0 ? "-" : ""}$${(abs / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${n < 0 ? "-" : ""}$${(abs / 1e3).toFixed(1)}K`
  return `${n < 0 ? "-" : ""}$${abs.toFixed(2)}`
}

const fmtPct = (n: number): string => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`

const fmtPrice = (n: number): string => `${(n * 100).toFixed(1)}¢`

const pnlColor = (n: number): string => n > 0 ? "text-accent-green" : n < 0 ? "text-data-bear" : "text-text-muted"

const fmtTime = (d: string): string => {
  const date = new Date(d)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return "now"
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d`
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export default function PaperTradingPage() {
  const [tab, setTab] = useState<Tab>("positions")
  const [stats, setStats] = useState<PortfolioStats | null>(null)
  const [trades, setTrades] = useState<PaperTrade[]>([])
  const [markets, setMarkets] = useState<Market[]>([])
  const [loading, setLoading] = useState(true)
  const [tradingLoading, setTradingLoading] = useState(false)

  // Trade form state
  const [selectedMarket, setSelectedMarket] = useState<string>("")
  const [direction, setDirection] = useState<"YES" | "NO">("YES")
  const [shares, setShares] = useState<string>("100")
  const [entryPrice, setEntryPrice] = useState<string>("0.50")
  const [tradeNote, setTradeNote] = useState("")
  const [marketSearch, setMarketSearch] = useState("")

  // Close trade state
  const [closingTrade, setClosingTrade] = useState<string | null>(null)
  const [exitPrice, setExitPrice] = useState("")

  const fetchStats = useCallback(async () => {
    try {
      const r = await fetch("/api/v1/paper-trades/stats")
      const d = await r.json()
      if (d.data) setStats(d.data)
    } catch { /* silent */ }
  }, [])

  const fetchTrades = useCallback(async () => {
    try {
      const r = await fetch("/api/v1/paper-trades?pageSize=100&status=open")
      const d = await r.json()
      setTrades(d.data ?? [])
    } catch { /* silent */ }
  }, [])

  const fetchMarkets = useCallback(async () => {
    try {
      const r = await fetch("/api/v1/predictions?pageSize=100&status=open")
      const d = await r.json()
      setMarkets(d.data ?? [])
    } catch { /* silent */ }
  }, [])

  const fetchHistory = useCallback(async () => {
    try {
      const r = await fetch("/api/v1/paper-trades?pageSize=100&status=closed")
      const d2 = await r.json()
      const r2 = await fetch("/api/v1/paper-trades?pageSize=100&status=resolved")
      const d3 = await r2.json()
      setTrades([...(d2.data ?? []), ...(d3.data ?? [])])
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      await Promise.all([fetchStats(), fetchTrades(), fetchMarkets()])
      setLoading(false)
    }
    load()
  }, [fetchStats, fetchTrades, fetchMarkets])

  useEffect(() => {
    if (tab === "history") fetchHistory()
    if (tab === "positions") fetchTrades()
  }, [tab, fetchHistory, fetchTrades])

  const handlePlaceTrade = async () => {
    if (!selectedMarket) return
    setTradingLoading(true)
    try {
      const r = await fetch("/api/v1/paper-trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketId: selectedMarket,
          direction,
          shares: parseFloat(shares),
          entryPrice: parseFloat(entryPrice),
          notes: tradeNote || undefined,
        }),
      })
      if (r.ok) {
        setSelectedMarket("")
        setShares("100")
        setEntryPrice("0.50")
        setTradeNote("")
        await Promise.all([fetchStats(), fetchTrades()])
        setTab("positions")
      }
    } catch { /* silent */ }
    setTradingLoading(false)
  }

  const handleCloseTrade = async (tradeId: string) => {
    const price = parseFloat(exitPrice)
    if (isNaN(price) || price <= 0 || price >= 1) return
    try {
      const r = await fetch(`/api/v1/paper-trades/${tradeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exitPrice: price }),
      })
      if (r.ok) {
        setClosingTrade(null)
        setExitPrice("")
        await Promise.all([fetchStats(), fetchTrades()])
      }
    } catch { /* silent */ }
  }

  const handleResolve = async (marketId: string, outcome: string) => {
    try {
      await fetch("/api/v1/paper-trades/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketId, outcome }),
      })
      await Promise.all([fetchStats(), fetchTrades()])
    } catch { /* silent */ }
  }

  const filteredMarkets = markets.filter(m =>
    !marketSearch ||
    m.symbol.toLowerCase().includes(marketSearch.toLowerCase()) ||
    m.category.toLowerCase().includes(marketSearch.toLowerCase())
  )

  const allClosedTrades = tab === "history" ? trades : (stats?.recentClosed ?? [])

  return (
    <NexusLayout>
      <div className="h-full overflow-auto p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-mono font-bold text-accent-cyan flex items-center gap-2">
            <Target size={14} /> PAPER TRADING
          </h1>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-accent-green animate-[live-dot_2s_ease-in-out_infinite]" />
            <span className="text-[10px] text-text-muted">SIMULATED</span>
          </div>
        </div>

        {/* KPI Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
            <KpiCard label="TOTAL P&L" value={fmtUsd(stats.totalPnl)} color={pnlColor(stats.totalPnl)} />
            <KpiCard label="WIN RATE" value={`${stats.winRate.toFixed(1)}%`} color={stats.winRate >= 50 ? "text-accent-green" : "text-data-bear"} />
            <KpiCard label="OPEN" value={String(stats.openTrades)} color="text-accent-cyan" />
            <KpiCard label="CLOSED" value={String(stats.closedTrades)} color="text-text-secondary" />
            <KpiCard label="BEST" value={fmtUsd(stats.bestTrade)} color="text-accent-green" />
            <KpiCard label="WORST" value={fmtUsd(stats.worstTrade)} color="text-data-bear" />
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex gap-1 border-b border-bg-border">
          {(["positions", "trade", "history"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-[11px] font-mono uppercase transition-colors border-b-2 ${
                tab === t
                  ? "text-accent-cyan border-accent-cyan"
                  : "text-text-muted border-transparent hover:text-text-secondary"
              }`}
            >
              {t === "positions" ? `Open (${stats?.openTrades ?? 0})` : t === "trade" ? "Place Trade" : "History"}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {loading ? (
          <div className="text-center py-20 text-text-dim text-xs">Loading portfolio...</div>
        ) : (
          <>
            {/* Positions Tab */}
            {tab === "positions" && (
              <div className="space-y-2">
                {trades.length === 0 ? (
                  <div className="text-center py-20 text-text-dim text-xs">
                    No open positions. Switch to &quot;Place Trade&quot; to start.
                  </div>
                ) : (
                  trades.map(trade => (
                    <div
                      key={trade.id}
                      className="bg-bg-panel border border-bg-border rounded-lg p-3 hover:border-border-active transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                              trade.direction === "YES"
                                ? "bg-accent-green/15 text-accent-green"
                                : "bg-data-bear/15 text-data-bear"
                            }`}>
                              {trade.direction}
                            </span>
                            <span className="text-[10px] font-mono text-text-muted bg-bg-raised px-1.5 py-0.5 rounded">
                              {trade.market.category}
                            </span>
                            <span className="text-[10px] text-text-dim">{fmtTime(trade.createdAt)}</span>
                          </div>
                          <p className="text-xs text-text-primary leading-tight truncate">
                            {trade.market.symbol}
                          </p>
                          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-text-muted font-mono">
                            <span>{trade.shares} shares @ {fmtPrice(trade.entryPrice)}</span>
                            <span>Cost: {fmtUsd(trade.shares * trade.entryPrice)}</span>
                            {trade.market.status === "resolved" && trade.market.outcome && (
                              <span className={trade.direction === trade.market.outcome ? "text-accent-green" : "text-data-bear"}>
                                Resolved: {trade.market.outcome}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1 shrink-0">
                          {trade.market.status === "resolved" && trade.market.outcome ? (
                            <button
                              onClick={() => handleResolve(trade.marketId, trade.market.outcome!)}
                              className="text-[10px] font-mono px-2 py-1 bg-accent-cyan/15 text-accent-cyan rounded hover:bg-accent-cyan/25 transition-colors"
                            >
                              Resolve
                            </button>
                          ) : closingTrade === trade.id ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                step="0.01"
                                min="0.01"
                                max="0.99"
                                value={exitPrice}
                                onChange={e => setExitPrice(e.target.value)}
                                placeholder="Exit ¢"
                                className="w-16 text-[10px] font-mono bg-bg-raised border border-bg-border rounded px-1.5 py-1 text-text-primary focus:outline-none focus:border-accent-cyan"
                              />
                              <button
                                onClick={() => handleCloseTrade(trade.id)}
                                className="p-1 text-accent-green hover:bg-accent-green/15 rounded"
                              >
                                <Check size={12} />
                              </button>
                              <button
                                onClick={() => { setClosingTrade(null); setExitPrice("") }}
                                className="p-1 text-text-muted hover:bg-bg-raised rounded"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setClosingTrade(trade.id)}
                              className="text-[10px] font-mono px-2 py-1 bg-bg-raised text-text-secondary rounded hover:bg-bg-border transition-colors"
                            >
                              Close
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Trade Tab */}
            {tab === "trade" && (
              <div className="max-w-xl space-y-4">
                <Panel title="Select Market">
                  <div className="p-3 space-y-3">
                    <input
                      type="text"
                      value={marketSearch}
                      onChange={e => setMarketSearch(e.target.value)}
                      placeholder="Search markets..."
                      className="w-full text-xs font-mono bg-bg-raised border border-bg-border rounded px-3 py-2 text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-cyan"
                    />
                    <div className="max-h-48 overflow-auto space-y-1 scrollbar-thin">
                      {filteredMarkets.length === 0 ? (
                        <div className="text-[10px] text-text-dim text-center py-4">No markets found</div>
                      ) : (
                        filteredMarkets.map(m => (
                          <button
                            key={m.id}
                            onClick={() => setSelectedMarket(m.id)}
                            className={`w-full text-left px-2.5 py-2 rounded text-xs transition-colors ${
                              selectedMarket === m.id
                                ? "bg-accent-cyan/15 border border-accent-cyan/30"
                                : "bg-bg-raised border border-transparent hover:border-bg-border"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex-1 min-w-0">
                                <span className="text-[10px] font-mono text-text-muted bg-bg-base px-1.5 py-0.5 rounded mr-2">
                                  {m.category}
                                </span>
                                <span className="text-text-primary truncate">{m.symbol}</span>
                              </div>
                              <span className="text-[10px] text-text-dim font-mono ml-2 shrink-0">
                                Vol: {fmtUsd(m.volume24h)}
                              </span>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </Panel>

                {selectedMarket && (
                  <Panel title="Order">
                    <div className="p-3 space-y-3">
                      {/* Direction */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => setDirection("YES")}
                          className={`flex-1 py-2 text-xs font-mono font-bold rounded transition-colors ${
                            direction === "YES"
                              ? "bg-accent-green/20 text-accent-green border border-accent-green/40"
                              : "bg-bg-raised text-text-muted border border-bg-border hover:border-accent-green/20"
                          }`}
                        >
                          <TrendingUp size={12} className="inline mr-1" /> YES
                        </button>
                        <button
                          onClick={() => setDirection("NO")}
                          className={`flex-1 py-2 text-xs font-mono font-bold rounded transition-colors ${
                            direction === "NO"
                              ? "bg-data-bear/20 text-data-bear border border-data-bear/40"
                              : "bg-bg-raised text-text-muted border border-bg-border hover:border-data-bear/20"
                          }`}
                        >
                          <TrendingDown size={12} className="inline mr-1" /> NO
                        </button>
                      </div>

                      {/* Price + Shares */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] text-text-muted font-mono mb-1 block">ENTRY PRICE</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            max="0.99"
                            value={entryPrice}
                            onChange={e => setEntryPrice(e.target.value)}
                            className="w-full text-xs font-mono bg-bg-raised border border-bg-border rounded px-3 py-2 text-text-primary focus:outline-none focus:border-accent-cyan"
                          />
                          <span className="text-[10px] text-text-dim mt-0.5 block">{fmtPrice(parseFloat(entryPrice) || 0)}/share</span>
                        </div>
                        <div>
                          <label className="text-[10px] text-text-muted font-mono mb-1 block">SHARES</label>
                          <input
                            type="number"
                            step="1"
                            min="1"
                            value={shares}
                            onChange={e => setShares(e.target.value)}
                            className="w-full text-xs font-mono bg-bg-raised border border-bg-border rounded px-3 py-2 text-text-primary focus:outline-none focus:border-accent-cyan"
                          />
                        </div>
                      </div>

                      {/* Notes */}
                      <div>
                        <label className="text-[10px] text-text-muted font-mono mb-1 block">NOTES (optional)</label>
                        <input
                          type="text"
                          value={tradeNote}
                          onChange={e => setTradeNote(e.target.value)}
                          placeholder="Your thesis..."
                          className="w-full text-xs font-mono bg-bg-raised border border-bg-border rounded px-3 py-2 text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-cyan"
                        />
                      </div>

                      {/* Order Summary */}
                      <div className="bg-bg-base rounded p-2.5 space-y-1 text-[10px] font-mono">
                        <div className="flex justify-between text-text-muted">
                          <span>Direction</span>
                          <span className={direction === "YES" ? "text-accent-green" : "text-data-bear"}>{direction}</span>
                        </div>
                        <div className="flex justify-between text-text-muted">
                          <span>Cost Basis</span>
                          <span className="text-text-primary">{fmtUsd((parseFloat(shares) || 0) * (parseFloat(entryPrice) || 0))}</span>
                        </div>
                        <div className="flex justify-between text-text-muted">
                          <span>Max Profit</span>
                          <span className="text-accent-green">{fmtUsd((parseFloat(shares) || 0) * (1 - (parseFloat(entryPrice) || 0)))}</span>
                        </div>
                        <div className="flex justify-between text-text-muted">
                          <span>Max Loss</span>
                          <span className="text-data-bear">{fmtUsd((parseFloat(shares) || 0) * (parseFloat(entryPrice) || 0))}</span>
                        </div>
                      </div>

                      <button
                        onClick={handlePlaceTrade}
                        disabled={tradingLoading || !selectedMarket || !shares || !entryPrice}
                        className="w-full py-2.5 text-xs font-mono font-bold bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/40 rounded hover:bg-accent-cyan/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        {tradingLoading ? "Placing..." : `Place ${direction} Order`}
                      </button>
                    </div>
                  </Panel>
                )}
              </div>
            )}

            {/* History Tab */}
            {tab === "history" && (
              <div className="space-y-2">
                {allClosedTrades.length === 0 ? (
                  <div className="text-center py-20 text-text-dim text-xs">No closed trades yet</div>
                ) : (
                  allClosedTrades.map(trade => (
                    <div
                      key={trade.id}
                      className="bg-bg-panel border border-bg-border rounded-lg p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                              trade.direction === "YES"
                                ? "bg-accent-green/15 text-accent-green"
                                : "bg-data-bear/15 text-data-bear"
                            }`}>
                              {trade.direction}
                            </span>
                            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                              trade.status === "resolved"
                                ? "bg-accent-amber/15 text-accent-amber"
                                : "bg-text-muted/15 text-text-muted"
                            }`}>
                              {trade.status}
                            </span>
                            <span className="text-[10px] font-mono text-text-muted bg-bg-raised px-1.5 py-0.5 rounded">
                              {trade.market.category}
                            </span>
                          </div>
                          <p className="text-xs text-text-primary leading-tight truncate">{trade.market.symbol}</p>
                          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-text-muted font-mono">
                            <span>{fmtPrice(trade.entryPrice)} → {trade.exitPrice != null ? fmtPrice(trade.exitPrice) : "—"}</span>
                            <span>{trade.shares} shares</span>
                            {trade.closedAt && <span>{fmtTime(trade.closedAt)}</span>}
                          </div>
                        </div>
                        <div className={`text-sm font-mono font-bold shrink-0 ${pnlColor(trade.pnl)}`}>
                          {trade.pnl >= 0 ? "+" : ""}{fmtUsd(trade.pnl)}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}

        {/* Direction Breakdown (when stats loaded) */}
        {stats && stats.totalTrades > 0 && tab === "positions" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Panel title="Direction Split" subtitle={`${stats.totalTrades} trades`}>
              <div className="p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-accent-green font-mono">YES</span>
                  <span className="text-text-muted text-[10px]">{stats.directionBreakdown.yes.count} trades · {fmtUsd(stats.directionBreakdown.yes.pnl)}</span>
                </div>
                <div className="h-1.5 bg-bg-raised rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent-green rounded-full"
                    style={{ width: `${stats.totalTrades > 0 ? (stats.directionBreakdown.yes.count / stats.totalTrades) * 100 : 0}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-data-bear font-mono">NO</span>
                  <span className="text-text-muted text-[10px]">{stats.directionBreakdown.no.count} trades · {fmtUsd(stats.directionBreakdown.no.pnl)}</span>
                </div>
                <div className="h-1.5 bg-bg-raised rounded-full overflow-hidden">
                  <div
                    className="h-full bg-data-bear rounded-full"
                    style={{ width: `${stats.totalTrades > 0 ? (stats.directionBreakdown.no.count / stats.totalTrades) * 100 : 0}%` }}
                  />
                </div>
              </div>
            </Panel>

            <Panel title="Category Breakdown">
              <div className="p-3 space-y-1.5">
                {Object.entries(stats.categoryBreakdown)
                  .sort((a, b) => b[1].count - a[1].count)
                  .slice(0, 6)
                  .map(([cat, data]) => (
                    <div key={cat} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-text-muted bg-bg-raised px-1.5 py-0.5 rounded">{cat}</span>
                        <span className="text-text-dim text-[10px]">{data.count}x</span>
                      </div>
                      <span className={`font-mono text-[10px] ${pnlColor(data.pnl)}`}>
                        {data.pnl >= 0 ? "+" : ""}{fmtUsd(data.pnl)}
                      </span>
                    </div>
                  ))}
                {Object.keys(stats.categoryBreakdown).length === 0 && (
                  <div className="text-[10px] text-text-dim text-center py-3">No data yet</div>
                )}
              </div>
            </Panel>
          </div>
        )}
      </div>
    </NexusLayout>
  )
}

function KpiCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-bg-panel border border-bg-border rounded-lg p-2.5">
      <div className="text-[9px] font-mono text-text-dim uppercase tracking-wider">{label}</div>
      <div className={`text-sm font-mono font-bold mt-0.5 ${color}`}>{value}</div>
    </div>
  )
}
