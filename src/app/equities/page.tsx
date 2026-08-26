"use client"

import { useState, useEffect } from "react"
import { NexusLayout } from "@/components/layout/NexusLayout"
import { useUserPreferences } from "@/lib/hooks/useUserPreferences"
import { useTableControls, TableControlsBar, SortableTh } from "@/components/shell/TableControls"
import { GLOBAL_STOCKS, INDEX_SYMBOLS, type UniverseStock } from "@/lib/config/universe"


type EquityStock = { symbol: string; name: string; sector: string }
type EquityQuote = { price: number; change: number; name: string }
type MarketCatalogEntry = { id: string; name: string; count?: number | null }

/** Quote backfill budget per selected market — keeps Yahoo chunk load bounded. */
const MARKET_QUOTE_CAP = 500
const QUOTE_CHUNK = 100


/**
 * One record-list table per sector; each instance owns its filter/sort state
 * via the shared primitives (no default sort — preserves declaration order).
 */
function SectorTable({
  sector,
  stocks,
  quotes,
}: {
  sector: string
  stocks: EquityStock[]
  quotes: Record<string, EquityQuote>
}) {
  const { format } = useUserPreferences()
  const tc = useTableControls(stocks, [
    { key: "symbol" },
    { key: "name" },
    { key: "price", accessor: s => quotes[s.symbol]?.price },
    { key: "change", accessor: s => quotes[s.symbol]?.change },
  ])
  const idPrefix = `equities-${sector.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
  return (
    <>
      <TableControlsBar idPrefix={idPrefix} query={tc.query} onQueryChange={tc.setQuery} shown={tc.visible.length} total={tc.total} placeholder={`Filter ${sector} stocks…`} />
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-text-muted border-b border-border-dim">
              <SortableTh controls={tc} k="symbol" className="text-left py-2 w-20">SYMBOL</SortableTh>
              <SortableTh controls={tc} k="name" className="text-left py-2">NAME</SortableTh>
              <SortableTh controls={tc} k="price" className="text-right py-2 w-24">PRICE</SortableTh>
              <SortableTh controls={tc} k="change" className="text-right py-2 w-20">CHANGE</SortableTh>
            </tr>
          </thead>
          <tbody>
            {tc.visible.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-3 text-center text-text-muted font-mono">No matching stocks</td>
              </tr>
            ) : tc.visible.map(s => {
              const q = quotes[s.symbol]
              if (!q) return null
              return (
                <tr key={s.symbol} className="border-b border-border-dim/30 hover:bg-bg-elevated">
                  <td className="py-2 font-mono text-accent-cyan">{s.symbol}</td>
                  <td className="py-2 text-text-dim">{s.name}</td>
                  <td className="py-2 text-right font-mono">{q.price != null ? format(q.price) : "—"}</td>
                  <td className={`py-2 text-right font-mono ${(q.change ?? 0) >= 0 ? "text-accent-green" : "text-accent-red"}`}>
                    {q.change != null ? `${q.change >= 0 ? "+" : ""}${q.change.toFixed(2)}%` : "—"}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

export default function EquitiesPage() {
  const [quotes, setQuotes] = useState<Record<string, EquityQuote>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const { format } = useUserPreferences()
  const [idxUniverse, setIdxUniverse] = useState<UniverseStock[] | null>(null)

  // Market explorer: '' = default curated+IDX view; otherwise a live
  // TradingView universe from /api/v1/equities/universe?market=<id>.
  const [catalog, setCatalog] = useState<MarketCatalogEntry[]>([])
  const [market, setMarket] = useState("")
  const [marketStocks, setMarketStocks] = useState<EquityStock[] | null>(null)
  const [marketLoading, setMarketLoading] = useState(false)

  // Displayed universe = curated global list, with the IDX section replaced
  // by the live IDX universe once loaded (idx.co.id → snapshot → fallback),
  // or the selected global-market listing when one is active.
  const allStocks: EquityStock[] =
    idxUniverse && idxUniverse.length > 0
      ? [...GLOBAL_STOCKS.filter((s) => !s.symbol.endsWith(".JK")).map((s) => ({ symbol: s.symbol, name: s.name, sector: s.sector ?? 'Global' })), ...idxUniverse.map((s) => ({ symbol: s.symbol, name: s.name, sector: s.sector ?? 'IDX' }))]
      : GLOBAL_STOCKS.map((s) => ({ symbol: s.symbol, name: s.name, sector: s.sector ?? 'Global' }))
  const displayed = market && marketStocks ? marketStocks : allStocks

  useEffect(() => {
    const allSymbols = GLOBAL_STOCKS.map(s => s.symbol).join(',')
    fetch(`/api/v1/equities?symbols=${allSymbols}`)
      .then(r => r.json())
      .then(d => {
        const map: Record<string, EquityQuote> = {}
        for (const q of d.data?.stocks ?? []) {
          map[q.symbol] = { price: q.price, change: q.changePercent, name: q.name ?? q.symbol }
        }
        for (const q of d.data?.indices ?? []) {
          map[q.symbol] = { price: q.price, change: q.changePercent, name: q.name ?? q.symbol }
        }
        setQuotes(map)
        setLoading(false)
      })
      .catch((err) => { setLoading(false); setError((err as Error).message) })
  }, [])

  // Dynamic IDX universe: TradingView live → snapshot → curated floor.
  // ?quotes=1 embeds the daily harvest's OHLCV so the IDX slice needs
  // zero Yahoo calls on warm paths; Yahoo only fills residual gaps.
  useEffect(() => {
    fetch('/api/v1/equities/universe?quotes=1')
      .then((r) => r.json())
      .then((d) => {
        const stocks = d.data?.stocks as Array<{ symbol: string; name: string; quote?: { close: number; changePct: number } | null }> | undefined
        if (!stocks?.length) return
        const snap: Record<string, EquityQuote> = {}
        for (const s of stocks) {
          if (s.quote && Number.isFinite(s.quote.close)) {
            snap[s.symbol] = { price: s.quote.close, change: s.quote.changePct, name: s.name }
          }
        }
        if (Object.keys(snap).length > 0) setQuotes((prev) => ({ ...prev, ...snap }))
        setIdxUniverse(stocks)
      })
      .catch(() => { /* curated fallback floor covers the UI */ })
  }, [])

  // Selection resets live in the handler (sanctioned cascade point); the
  // effect below only performs the network fetch for a non-empty market.
  const selectMarket = (id: string) => {
    setMarket(id)
    if (!id) {
      setMarketStocks(null)
      setMarketLoading(false)
      return
    }
    setMarketStocks(null)
    setMarketLoading(true)
  }
  // Market catalog for the picker (?markets=1 — no listing payload).
  useEffect(() => {
    fetch('/api/v1/equities/universe?markets=1')
      .then((r) => r.json())
      .then((d) => setCatalog(d.data?.markets ?? []))
      .catch(() => { /* picker simply stays empty */ })
  }, [])

  // Selected market: load its universe, then backfill quotes progressively
  // (chunks of 100 up to MARKET_QUOTE_CAP — rows appear as quotes arrive;
  // the full listing remains searchable once its chunk lands).
  useEffect(() => {
    if (!market) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/v1/equities/universe?market=${encodeURIComponent(market)}`)
        const d = await res.json()
        if (cancelled) return
        const rows = (d.data?.stocks ?? []) as Array<{ symbol: string; name: string; exchange: string }>
        const mapped: EquityStock[] = rows.map((s) => ({ symbol: s.symbol, name: s.name, sector: s.exchange || 'LISTED' }))
        setMarketStocks(mapped)
        setMarketLoading(false)
        const targets = mapped.slice(0, MARKET_QUOTE_CAP)
        for (let i = 0; i < targets.length; i += QUOTE_CHUNK) {
          const slice = targets.slice(i, i + QUOTE_CHUNK).map((s) => s.symbol)
          try {
            const qr = await fetch(`/api/v1/equities?symbols=${slice.join(',')}`)
            const qd = await qr.json()
            if (cancelled) return
            const map: Record<string, EquityQuote> = {}
            for (const q of qd.data?.stocks ?? []) {
              map[q.symbol] = { price: q.price, change: q.changePercent, name: q.name ?? q.symbol }
            }
            setQuotes((prev) => ({ ...prev, ...map }))
          } catch { /* leave those rows without quotes */ }
        }
      } catch {
        if (!cancelled) {
          setMarketLoading(false)
          setError(`Failed to load ${market} universe`)
        }
      }
    })()
    return () => { cancelled = true }
  }, [market])

  // Backfill quotes for IDX symbols that only exist in the live universe.
  useEffect(() => {
    if (!idxUniverse) return
    const missing = idxUniverse.map((s) => s.symbol).filter((sym) => !(sym in quotes))
    if (missing.length === 0) return
    let cancelled = false
    const CHUNK = 100
    ;(async () => {
      for (let i = 0; i < missing.length; i += CHUNK) {
        const slice = missing.slice(i, i + CHUNK)
        try {
          const res = await fetch(`/api/v1/equities?symbols=${slice.join(',')}`)
          const d = await res.json()
          if (cancelled) return
          const map: Record<string, EquityQuote> = {}
          for (const q of d.data?.stocks ?? []) {
            map[q.symbol] = { price: q.price, change: q.changePercent, name: q.name ?? q.symbol }
          }
          setQuotes((prev) => ({ ...prev, ...map }))
        } catch { /* leave those rows without quotes */ }
      }
    })()
    return () => { cancelled = true }
    // One backfill pass per universe load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idxUniverse])

  // Group stocks by sector (or exchange prefix when a market is selected)
  const sectors = [...new Set(displayed.map((s) => s.sector))]
  const marketName = catalog.find((c) => c.id === market)?.name

  return (
    <NexusLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="page-title">GLOBAL EQUITIES</h1>
          <span className="text-[10px] text-text-muted font-mono">
            {market && marketStocks
              ? `${marketStocks.length} listings · ${marketName ?? market}`
              : `${allStocks.length} stocks · ${INDEX_SYMBOLS.length} indices · 14 exchanges`}
          </span>
        </div>

        {/* Market picker */}
        <div className="flex items-center gap-3">
          <label htmlFor="equities-market" className="text-[10px] font-mono text-text-muted uppercase tracking-wide">Market</label>
          <select
            id="equities-market"
            value={market}
            onChange={(e) => selectMarket(e.target.value)}
            className="bg-bg-raised border border-border-dim rounded px-2 py-1.5 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-cyan"
          >
            <option value="">Indonesia + Global Majors</option>
            {catalog.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{typeof c.count === 'number' ? ` · ${c.count.toLocaleString('en-US')}` : ''}</option>
            ))}
          </select>
          {market && marketStocks && marketStocks.length > MARKET_QUOTE_CAP && (
            <span className="text-[10px] text-text-muted font-mono">
              quotes streaming for first {MARKET_QUOTE_CAP} listings
            </span>
          )}
        </div>
        {error && <div className="text-data-bear text-[11px] font-mono p-4">Error: {error}</div>}

        {/* Indices */}
        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-semibold text-text-secondary mb-3">MAJOR INDICES</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="p-2 animate-pulse space-y-1.5">
                  <div className="h-3 bg-bg-raised rounded w-16" />
                  <div className="h-6 bg-bg-raised rounded w-24" />
                  <div className="h-4 bg-bg-raised rounded w-12" />
                </div>
              ))
            ) : (
              INDEX_SYMBOLS.map(sym => {
                const q = quotes[sym]
                return (
                  <div key={sym} className="p-2">
                    <p className="text-[10px] text-text-muted">{q?.name ?? sym}</p>
                    <p className="text-lg font-mono font-bold">{q?.price != null ? format(q.price) : '—'}</p>
                    <p className={`text-xs font-mono ${(q?.change ?? 0) >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                      {q?.change != null ? `${q.change >= 0 ? '+' : ''}${q.change.toFixed(2)}%` : '—'}
                    </p>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* All Stocks by Sector (or by exchange within a market) */}
        {loading || marketLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-bg-panel border border-border-dim rounded-lg p-4 animate-pulse space-y-3">
                <div className="h-4 bg-bg-raised rounded w-32" />
                <div className="space-y-2">
                  <div className="flex justify-between border-b border-border-dim/20 pb-1">
                    <div className="h-3 bg-bg-raised rounded w-24" />
                    <div className="h-3 bg-bg-raised rounded w-12" />
                  </div>
                  <div className="flex justify-between border-b border-border-dim/20 pb-1">
                    <div className="h-3 bg-bg-raised rounded w-16" />
                    <div className="h-3 bg-bg-raised rounded w-10" />
                  </div>
                  <div className="flex justify-between">
                    <div className="h-3 bg-bg-raised rounded w-20" />
                    <div className="h-3 bg-bg-raised rounded w-8" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          sectors.map(sector => {
            const stocks = displayed.filter(s => s.sector === sector).filter(s => quotes[s.symbol])
            if (stocks.length === 0) return null
            return (
              <div key={sector} className="bg-bg-panel border border-border-dim rounded-lg p-4">
                <h2 className="text-xs font-semibold text-text-secondary mb-3">{sector.toUpperCase()}</h2>
                <SectorTable
                  sector={sector}
                  stocks={stocks}
                  quotes={quotes}
                />
              </div>
            )
          })
        )}
      </div>
    </NexusLayout>
  )
}
