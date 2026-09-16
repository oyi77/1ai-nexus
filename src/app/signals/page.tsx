"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { NexusLayout } from "@/components/layout/NexusLayout"
import { LiveDot } from "@/components/primitives/LiveDot"

type ConvictionItem = { symbol: string; conviction?: number; verdict?: string; direction?: string; action?: string }
type AlphaItem = { asset?: string; symbol?: string; direction?: string; type?: string; confidence?: number }
type IdxItem = { code: string; name?: string; rsScore?: number; distancePct?: number; proximityPct?: number; accdist?: string }

const TABS = [
  ["conviction", "CONVICTION"],
  ["alpha", "ALPHA"],
  ["idx", "IDX"],
] as const
type Tab = (typeof TABS)[number][0]

const signCls = (v: number | null | undefined) =>
  v === null || v === undefined ? "text-text-muted" : v >= 0 ? "text-accent-green" : "text-accent-red"

function Panel({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return (
    <div className="bg-bg-panel border border-border-dim rounded-lg p-4 overflow-x-auto">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-text-secondary">{title}</h3>
        <Link href={href} className="text-xs text-accent-blue hover:text-accent-blue/80">Detail →</Link>
      </div>
      {children}
    </div>
  )
}

function MiniTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <table className="w-full text-xs tabular-nums">
      <thead>
        <tr className="text-text-muted border-b border-border-dim">
          {head.map((h) => (
            <th key={h} className="text-left py-1 pr-3">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((cells, i) => (
          <tr key={i} className="border-b border-border-dim/30">
            {cells.map((c, j) => (
              <td key={j} className="py-1 pr-3">{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function SignalsHubPage() {
  const [tab, setTab] = useState<Tab>("conviction")
  const [loading, setLoading] = useState(true)
  const [conv, setConv] = useState<ConvictionItem[]>([])
  const [alpha, setAlpha] = useState<AlphaItem[]>([])
  const [idx, setIdx] = useState<IdxItem[]>([])
  const [idxView, setIdxView] = useState<"rs" | "breakout" | "ara" | "bandar">("rs")

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        if (tab === "conviction") {
          const d = await (await fetch("/api/v1/conviction")).json()
          if (!cancelled) {
            const mkts: Array<{ label?: string; items?: ConvictionItem[] }> =
              d.data?.markets ?? (Array.isArray(d.data) ? d.data : [])
            const flat = mkts.flatMap((m) =>
              (m.items ?? []).map((c) => ({ ...c, market: m.label ?? "" })),
            )
            setConv(flat.slice(0, 12))
          }
        } else if (tab === "alpha") {
          const d = await (await fetch("/api/v1/alpha-feed?limit=12")).json()
          if (!cancelled) setAlpha(Array.isArray(d.data) ? d.data : [])
        } else {
          const d = await (await fetch(`/api/v1/saham/signals?view=${idxView}&limit=12`)).json()
          if (!cancelled) setIdx(d.data?.items ?? [])
        }
      } catch { /* leave previous */ }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [tab, idxView])

  return (
    <NexusLayout>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 pt-6 pb-4 border-b border-border-dim">
          <div className="flex items-center gap-2">
            <LiveDot status={loading ? "stale" : "live"} label />
            <h1 className="text-xl font-semibold text-text-primary">Signals</h1>
            <span className="text-xs text-text-tertiary">every lane · one page</span>
          </div>
          <div className="flex gap-2 mt-4">
            {TABS.map(([t, label]) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-xs font-mono uppercase rounded border transition-colors ${
                  tab === t
                    ? "bg-teal-vivid text-bg-base border-teal-vivid font-bold"
                    : "bg-bg-panel border-border-dim text-text-muted hover:border-border-active"
                }`}>
                {label}
              </button>
            ))}
            {tab === "idx" && (
              <select value={idxView} onChange={(e) => setIdxView(e.target.value as typeof idxView)}
                className="bg-bg-panel border border-border-dim rounded px-2 py-1.5 text-xs text-text-primary">
                {(["rs", "breakout", "ara", "bandar"] as const).map((v) => (
                  <option key={v} value={v}>{v.toUpperCase()}</option>
                ))}
              </select>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="text-text-tertiary text-sm">Loading…</div>
          ) : tab === "conviction" ? (
            <Panel title="CONVICTION — CROSS-ASSET BUY/WAIT/SELL" href="/intelligence">
              <MiniTable head={["Symbol", "Conviction", "Verdict"]}
                rows={conv.map((c) => [
                  <span key={`${c.symbol}-s`} className="font-mono font-semibold text-teal-vivid">{c.symbol}</span>,
                  <span key={`${c.symbol}-c`}>{c.conviction ?? c.direction ?? "—"}</span>,
                  <span key={`${c.symbol}-v`}>{c.verdict ?? c.action ?? "—"}</span>,
                ])}
              />
            </Panel>
          ) : tab === "alpha" ? (
            <Panel title="ALPHA FEED — CURATED OPPORTUNITIES" href="/alpha">
              <MiniTable head={["Asset", "Type", "Direction", "Confidence"]}
                rows={alpha.map((a, i) => [
                  <span key={`s${i}-${a.asset ?? a.symbol ?? i}`} className="font-mono font-semibold text-teal-vivid">{a.asset ?? a.symbol ?? "—"}</span>,
                  <span key={`t${i}`}>{a.type ?? "—"}</span>,
                  <span key={`d${i}`}>{a.direction ?? "—"}</span>,
                  <span key={`c${i}`}>{a.confidence ?? "—"}</span>,
                ])}
              />
            </Panel>
          ) : (
            <Panel title={`IDX SIGNALS — ${idxView.toUpperCase()}`} href="/saham-signals">
              <MiniTable head={["Code", "Name/Info", "Signal"]}
                rows={idx.map((r) => [
                  <span key={`${r.code}-s`} className="font-mono font-semibold text-teal-vivid">{r.code}</span>,
                  <span key={`${r.code}-n`}>{r.name ?? r.accdist ?? "—"}</span>,
                  <span key="v" className={signCls(r.rsScore ?? r.distancePct ?? r.proximityPct ?? null)}>
                    {r.rsScore !== undefined ? `score ${r.rsScore.toFixed(0)}`
                      : r.distancePct !== undefined ? `${r.distancePct.toFixed(2)}% to high`
                      : r.proximityPct !== undefined ? `+${r.proximityPct.toFixed(1)}% to ARA`
                      : (r.accdist ?? "—")}
                  </span>,
                ])}
              />
            </Panel>
          )}
        </div>
      </div>
    </NexusLayout>
  )
}
