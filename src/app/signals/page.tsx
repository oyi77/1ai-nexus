"use client"

import { useState, useEffect, Suspense } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { NexusLayout } from "@/components/layout/NexusLayout"
import { LiveDot } from "@/components/primitives/LiveDot"

type ConvictionItem = { symbol: string; conviction?: number; verdict?: string; direction?: string; action?: string }
type AlphaItem = { asset?: string; symbol?: string; direction?: string; type?: string; confidence?: number }
type IdxItem = { code: string; name?: string; rsScore?: number; distancePct?: number; proximityPct?: number; accdist?: string }

interface Transmission {
  id: string
  from: string
  to: string[]
  direction: 'bullish' | 'bearish' | 'neutral'
  narrative: string
  evidence: Array<{ metric: string; value: string; source: string }>
  confidence: number
  unproven: boolean
}

interface InsightBriefData {
  generatedAt: string
  regime: 'risk-on' | 'risk-off' | 'mixed'
  transmissions: Transmission[]
}

const TABS = [
  ["conviction", "CONVICTION"],
  ["alpha", "ALPHA"],
  ["idx", "IDX"],
  ["macro", "MACRO TRANSMISSIONS"],
] as const
type Tab = (typeof TABS)[number][0]

const signCls = (v: number | null | undefined) =>
  v === null || v === undefined ? "text-text-muted" : v >= 0 ? "text-accent-green" : "text-accent-red"

function Panel({ title, href, children }: { title: string; href?: string; children: React.ReactNode }) {
  return (
    <div className="bg-bg-panel border border-border-dim rounded-lg p-4 overflow-x-auto">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-text-secondary">{title}</h3>
        {href && (
          <Link href={href} className="text-xs text-accent-blue hover:text-accent-blue/80">
            Detail →
          </Link>
        )}
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

function SignalsContent() {
  const searchParams = useSearchParams()
  const initialTab = (searchParams.get("tab") as Tab) ?? "conviction"
  const [tab, setTab] = useState<Tab>(
    TABS.some(([t]) => t === initialTab) ? initialTab : "conviction"
  )
  const [loading, setLoading] = useState(true)
  const [conv, setConv] = useState<ConvictionItem[]>([])
  const [alpha, setAlpha] = useState<AlphaItem[]>([])
  const [idx, setIdx] = useState<IdxItem[]>([])
  const [idxView, setIdxView] = useState<"rs" | "breakout" | "ara" | "bandar">("rs")
  const [brief, setBrief] = useState<InsightBriefData | null>(null)

  useEffect(() => {
    let alive = true
    const qTab = searchParams.get("tab") as Tab
    if (qTab && TABS.some(([t]) => t === qTab)) {
      queueMicrotask(() => {
        if (alive) setTab(qTab)
      })
    }
    return () => {
      alive = false
    }
  }, [searchParams])
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        if (tab === "conviction") {
          const res = await fetch("/api/v1/conviction")
          const d = await res.json()
          if (!cancelled) {
            const mkts: Array<{ label?: string; items?: ConvictionItem[] }> =
              d.data?.markets ?? (Array.isArray(d.data) ? d.data : [])
            const flat = mkts.flatMap((m) =>
              (m.items ?? []).map((c) => ({ ...c, market: m.label ?? "" })),
            )
            setConv(flat.slice(0, 12))
          }
        } else if (tab === "alpha") {
          const res = await fetch("/api/v1/alpha-feed?limit=12")
          const d = await res.json()
          if (!cancelled) setAlpha(Array.isArray(d.data) ? d.data : [])
        } else if (tab === "idx") {
          const res = await fetch(`/api/v1/saham/signals?view=${idxView}&limit=12`)
          const d = await res.json()
          if (!cancelled) setIdx(d.data?.items ?? [])
        } else if (tab === "macro") {
          const res = await fetch("/api/v1/insight-brief")
          const d = await res.json()
          if (!cancelled) setBrief(d.data ?? null)
        }
      } catch {
        /* keep previous state on failure */
      }
      if (!cancelled) setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [tab, idxView])

  const curveTx = brief?.transmissions.find((t) => t.id === "macro-yield-curve")
  const creditTx = brief?.transmissions.find((t) => t.id === "macro-credit-spread")

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-6 pt-6 pb-4 border-b border-border-dim">
        <div className="flex items-center gap-2">
          <LiveDot status={loading ? "stale" : "live"} label />
          <h1 className="text-xl font-semibold text-text-primary">Signals</h1>
          <span className="text-xs text-text-tertiary">every lane · one page</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-4">
          {TABS.map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-xs font-mono uppercase rounded border transition-colors ${
                tab === t
                  ? "bg-teal-vivid text-bg-base border-teal-vivid font-bold"
                  : "bg-bg-panel border-border-dim text-text-muted hover:border-border-active"
              }`}
            >
              {label}
            </button>
          ))}
          {tab === "idx" && (
            <select
              value={idxView}
              onChange={(e) => setIdxView(e.target.value as typeof idxView)}
              className="bg-bg-panel border border-border-dim rounded px-2 py-1.5 text-xs text-text-primary"
            >
              {(["rs", "breakout", "ara", "bandar"] as const).map((v) => (
                <option key={v} value={v}>
                  {v.toUpperCase()}
                </option>
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
            <MiniTable
              head={["Symbol", "Conviction", "Verdict"]}
              rows={conv.map((c) => [
                <span key={`${c.symbol}-s`} className="font-mono font-semibold text-teal-vivid">
                  {c.symbol}
                </span>,
                <span key={`${c.symbol}-c`}>{c.conviction ?? c.direction ?? "—"}</span>,
                <span key={`${c.symbol}-v`}>{c.verdict ?? c.action ?? "—"}</span>,
              ])}
            />
          </Panel>
        ) : tab === "alpha" ? (
          <Panel title="ALPHA FEED — CURATED OPPORTUNITIES" href="/alpha">
            <MiniTable
              head={["Asset", "Type", "Direction", "Confidence"]}
              rows={alpha.map((a, i) => [
                <span key={`s${i}-${a.asset ?? a.symbol ?? i}`} className="font-mono font-semibold text-teal-vivid">
                  {a.asset ?? a.symbol ?? "—"}
                </span>,
                <span key={`t${i}`}>{a.type ?? "—"}</span>,
                <span key={`d${i}`}>{a.direction ?? "—"}</span>,
                <span key={`c${i}`}>{a.confidence ?? "—"}</span>,
              ])}
            />
          </Panel>
        ) : tab === "idx" ? (
          <Panel title={`IDX SIGNALS — ${idxView.toUpperCase()}`} href="/saham?tab=signals">
            <MiniTable
              head={["Code", "Name/Info", "Signal"]}
              rows={idx.map((r) => [
                <span key={`${r.code}-s`} className="font-mono font-semibold text-teal-vivid">
                  {r.code}
                </span>,
                <span key={`${r.code}-n`}>{r.name ?? r.accdist ?? "—"}</span>,
                <span
                  key="v"
                  className={signCls(r.rsScore ?? r.distancePct ?? r.proximityPct ?? null)}
                >
                  {r.rsScore !== undefined
                    ? `score ${r.rsScore.toFixed(0)}`
                    : r.distancePct !== undefined
                    ? `${r.distancePct.toFixed(2)}% to high`
                    : r.proximityPct !== undefined
                    ? `+${r.proximityPct.toFixed(1)}% to ARA`
                    : r.accdist ?? "—"}
                </span>,
              ])}
            />
          </Panel>
        ) : (
          <div className="space-y-4">
            {brief?.regime && (
              <div className="flex items-center justify-between p-3 rounded-lg border border-border-dim bg-bg-panel">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono uppercase text-text-muted">Macro Regime:</span>
                  <span
                    className={`px-2 py-0.5 text-xs font-mono font-semibold rounded uppercase ${
                      brief.regime === "risk-on"
                        ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                        : brief.regime === "risk-off"
                        ? "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                        : "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                    }`}
                  >
                    {brief.regime}
                  </span>
                </div>
                <span className="text-[11px] font-mono text-text-muted">
                  Updated: {new Date(brief.generatedAt).toLocaleTimeString()}
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Macro Yield Curve Panel */}
              <div className="p-4 rounded-lg border border-border-dim bg-bg-panel space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                    US Yield Curve Transmission
                  </span>
                  {curveTx && (
                    <span
                      className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded uppercase ${
                        curveTx.direction === "bullish"
                          ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                          : curveTx.direction === "bearish"
                          ? "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                          : "bg-zinc-500/15 text-zinc-300 border border-zinc-500/30"
                      }`}
                    >
                      {curveTx.direction}
                    </span>
                  )}
                </div>
                {curveTx ? (
                  <>
                    <p className="text-xs text-text-primary leading-relaxed">{curveTx.narrative}</p>
                    <div className="pt-2 border-t border-border-dim/40 flex flex-wrap gap-3 text-[11px] font-mono text-text-muted">
                      {curveTx.evidence.map((ev, i) => (
                        <span key={i} className="bg-bg-base/60 px-2 py-0.5 rounded border border-border-dim/30">
                          {ev.metric}: <strong className="text-text-primary">{ev.value}</strong>
                        </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-text-muted">Yield curve data points loading…</p>
                )}
              </div>

              {/* Macro Credit Spread Panel */}
              <div className="p-4 rounded-lg border border-border-dim bg-bg-panel space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                    Baa Corporate Credit Spread
                  </span>
                  {creditTx && (
                    <span
                      className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded uppercase ${
                        creditTx.direction === "bullish"
                          ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                          : creditTx.direction === "bearish"
                          ? "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                          : "bg-zinc-500/15 text-zinc-300 border border-zinc-500/30"
                      }`}
                    >
                      {creditTx.direction}
                    </span>
                  )}
                </div>
                {creditTx ? (
                  <>
                    <p className="text-xs text-text-primary leading-relaxed">{creditTx.narrative}</p>
                    <div className="pt-2 border-t border-border-dim/40 flex flex-wrap gap-3 text-[11px] font-mono text-text-muted">
                      {creditTx.evidence.map((ev, i) => (
                        <span key={i} className="bg-bg-base/60 px-2 py-0.5 rounded border border-border-dim/30">
                          {ev.metric}: <strong className="text-text-primary">{ev.value}</strong>
                        </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-text-muted">Credit spread data points loading…</p>
                )}
              </div>
            </div>

            {/* All Active Transmissions Table */}
            <Panel title="CROSS-ASSET TRANSMISSIONS (MEASURED CONFIDENCE)" href="/api-docs">
              <MiniTable
                head={["Transmission ID", "From", "To Target", "Direction", "Confidence"]}
                rows={(brief?.transmissions ?? []).map((t) => [
                  <span key={`${t.id}-id`} className="font-mono font-semibold text-teal-vivid">
                    {t.id}
                  </span>,
                  <span key={`${t.id}-f`} className="text-text-secondary max-w-[220px] truncate block" title={t.from}>
                    {t.from}
                  </span>,
                  <span key={`${t.id}-to`} className="text-text-muted">
                    {t.to.join(", ")}
                  </span>,
                  <span
                    key={`${t.id}-d`}
                    className={`font-mono text-[11px] font-semibold uppercase ${
                      t.direction === "bullish"
                        ? "text-accent-green"
                        : t.direction === "bearish"
                        ? "text-accent-red"
                        : "text-text-muted"
                    }`}
                  >
                    {t.direction}
                  </span>,
                  <span key={`${t.id}-c`} className="font-mono">
                    {t.confidence}% {t.unproven ? "(unproven)" : "(measured)"}
                  </span>,
                ])}
              />
            </Panel>
          </div>
        )}
      </div>
    </div>
  )
}

export default function SignalsHubPage() {
  return (
    <NexusLayout>
      <Suspense fallback={<div className="p-6 text-xs text-text-muted font-mono">Loading signals…</div>}>
        <SignalsContent />
      </Suspense>
    </NexusLayout>
  )
}
