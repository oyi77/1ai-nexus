"use client"

import { useState, useEffect } from "react"

type DualPair = { idx: string; us: string }
type DualQuote = { idx: string; us: string; idxClose: number | null; usPrice: number | null; usDayPct: number | null; note: string }
type CalendarEvent = { symbol: string; kind: string; exdate: string; recordDate: string; payDate: string; value: string }

const signCls = (v: number | null) =>
  v === null ? "text-text-muted" : v >= 0 ? "text-accent-green" : "text-accent-red"

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-bg-panel border border-border-dim rounded-lg p-4 overflow-x-auto mb-4">
      <h3 className="text-xs font-semibold text-text-secondary mb-3">{title}</h3>
      {children}
    </div>
  )
}

export default function MarketsView({ externalQuery }: { externalQuery?: string }) {
  const [pairs, setPairs] = useState<DualPair[]>([])
  const [quote, setQuote] = useState<DualQuote | null>(null)
  const [indices, setIndices] = useState<string[]>([])
  const [indexSel, setIndexSel] = useState("IDX30")
  const [members, setMembers] = useState<string[]>([])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [calState, setCalState] = useState<"loading" | "live" | "unavailable">("loading")

  const q = (externalQuery ?? "").trim().toLowerCase()
  const match = (s: string) => !q || s.toLowerCase().includes(q)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const d = await (await fetch("/api/v1/saham/dual")).json()
        if (!cancelled) setPairs(d.data?.pairs ?? [])
      } catch { /* leave previous */ }
      try {
        const m = await (await fetch("/api/v1/saham/ajaib?market=indices")).json()
        if (!cancelled) setIndices(Object.keys(m.data?.indices ?? {}))
      } catch { /* leave previous */ }
      try {
        const c = await (await fetch("/api/v1/saham/calendar")).json()
        if (!cancelled) {
          if (Array.isArray(c.data?.dividends)) {
            setEvents(c.data.dividends)
            setCalState("live")
          } else {
            setCalState("unavailable")
          }
        }
      } catch {
        if (!cancelled) setCalState("unavailable")
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const d = await (await fetch("/api/v1/saham/dual?symbol=TLKM")).json()
        if (!cancelled && d.data?.idx) setQuote(d.data as DualQuote)
      } catch { /* leave previous */ }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const m = await (await fetch(`/api/v1/saham/ajaib?market=indices&index=${encodeURIComponent(indexSel)}`)).json()
        if (!cancelled) setMembers(m.data?.codes ?? [])
      } catch { /* leave previous */ }
    })()
    return () => { cancelled = true }
  }, [indexSel])

  return (
    <>
      <Panel title="DUAL LISTINGS — IDX × US (informational, not FX-adjusted)">
        {quote && match(quote.idx) && (
          <p className="text-xs font-mono mb-2">
            <span className="font-bold text-teal-vivid">{quote.idx}</span>
            <span className="text-text-muted"> close Rp{(quote.idxClose ?? 0).toLocaleString("id-ID")}</span>
            <span className="text-text-muted"> · {quote.us} ${quote.usPrice ?? "—"}</span>
            <span className={signCls(quote.usDayPct)}> ({quote.usDayPct === null ? "—" : `${quote.usDayPct >= 0 ? "+" : ""}${quote.usDayPct.toFixed(2)}%`})</span>
          </p>
        )}
        <p className="text-[11px] font-mono text-text-muted">
          {pairs.length === 0 ? "No dual pairs known." : `Tracked pairs: ${pairs.filter((p) => match(p.idx)).map((p) => `${p.idx}/${p.us}`).join(", ")}`}
        </p>
      </Panel>

      <Panel title="INDEX MEMBERSHIP — IDX indices (live)">
        <div className="flex gap-2 mb-3 flex-wrap">
          {indices.map((ix) => (
            <button key={ix} onClick={() => setIndexSel(ix)}
              className={`px-2 py-1 text-xs font-mono uppercase rounded border ${indexSel === ix ? "bg-teal-vivid text-bg-base border-teal-vivid font-bold" : "bg-bg-panel border-border-dim text-text-muted"}`}>
              {ix}
            </button>
          ))}
        </div>
        <p className="text-xs font-mono text-text-secondary">
          {indexSel}: {members.length} members{members.length > 0 && ` — ${members.filter(match).slice(0, 30).join(", ")}${members.length > 30 ? "…" : ""}`}
        </p>
      </Panel>

      <Panel title="CORPORATE CALENDAR — dividends & actions">
        {calState === "loading" && <p className="text-xs font-mono text-text-muted">Loading…</p>}
        {calState === "unavailable" && (
          <p className="text-xs font-mono text-text-muted">Temporarily unavailable — showing again after the next data sync.</p>
        )}
        {calState === "live" && (
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-text-muted border-b border-border-dim">
                <th className="text-left py-1">Symbol</th>
                <th className="text-left py-1">Kind</th>
                <th className="text-right py-1">Ex-date</th>
                <th className="text-right py-1">Value</th>
              </tr>
            </thead>
            <tbody>
              {events.filter((e) => match(e.symbol)).slice(0, 50).map((e, i) => (
                <tr key={`${e.symbol}-${e.exdate}-${i}`} className="border-b border-border-dim/30">
                  <td className="py-1 font-mono font-semibold text-teal-vivid">{e.symbol}</td>
                  <td className="py-1">{e.kind}</td>
                  <td className="py-1 text-right font-mono">{e.exdate || "—"}</td>
                  <td className="py-1 text-right font-mono">{e.value || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  )
}
