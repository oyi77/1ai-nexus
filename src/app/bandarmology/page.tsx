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

const fmtIdrB = (v: number) => `${(Math.abs(v) / 1e9).toFixed(2)}M` // miliar IDR
const fmtVol = (v: number) => (Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${(v / 1e3).toFixed(0)}K`)
const signCls = (v: number) => (v >= 0 ? "text-accent-green" : "text-accent-red")

function LeaderTable({ title, rows }: { title: string; rows: Leader[] }) {
  return (
    <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
      <h3 className="text-xs font-mono text-accent-cyan mb-3">{title}</h3>
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="text-text-muted border-b border-border-dim">
            <th className="text-left py-1">Code</th>
            <th className="text-right py-1">Close</th>
            <th className="text-right py-1">Chg%</th>
            <th className="text-right py-1">Net Vol</th>
            <th className="text-right py-1">Est Net Val</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code} className="border-b border-border-dim/30">
              <td className="py-1">
                <span className="font-bold">{r.code}</span>
                <span className="text-text-muted ml-2 hidden md:inline">{r.name.slice(0, 22)}</span>
              </td>
              <td className="text-right">{r.close.toLocaleString("id-ID")}</td>
              <td className={`text-right ${signCls(r.changePct)}`}>{r.changePct >= 0 ? "+" : ""}{r.changePct.toFixed(2)}%</td>
              <td className={`text-right ${signCls(r.netVol)}`}>{fmtVol(r.netVol)}</td>
              <td className={`text-right ${signCls(r.estNetValueIdr)}`}>Rp{fmtIdrB(r.estNetValueIdr)}B</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function BandarmologyPage() {
  const [tab, setTab] = useState<"leaders" | "streaks" | "brokers">("leaders")
  const [meta, setMeta] = useState<{ tradeDate?: string; capturedAt?: string; count?: number }>({})
  const [topBuy, setTopBuy] = useState<Leader[]>([])
  const [topSell, setTopSell] = useState<Leader[]>([])
  const [acc, setAcc] = useState<Streak[]>([])
  const [dist, setDist] = useState<Streak[]>([])
  const [brokers, setBrokers] = useState<Broker[]>([])
  const [symbol, setSymbol] = useState("")
  const [seriesTxt, setSeriesTxt] = useState<string>("")
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
        } else {
          const d = await (await fetch("/api/v1/saham/bandarmology?view=brokers&limit=25")).json()
          if (!cancelled) {
            setBrokers(d.data?.rows ?? [])
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
    setSeriesTxt("…")
    fetch(`/api/v1/saham/bandarmology?view=series&symbol=${sym}&days=30`)
      .then((r) => r.json())
      .then((d) => {
        const s = d.data?.series as Array<{ date: string; net: number }> | undefined
        if (!s || s.length === 0) { setSeriesTxt(`${sym}: no history yet (history builds daily)`); return }
        const max = Math.max(...s.map((x) => Math.abs(x.net)), 1)
        const bars = s.map((x) => {
          const lvl = Math.ceil((Math.abs(x.net) / max) * 8)
          const block = x.net >= 0 ? "▁▂▃▄▅▆▇█"[lvl - 1] ?? "█" : "▔▕▏╸▏▕▔ "[lvl - 1] ?? "│"
          return block
        }).join("")
        setSeriesTxt(`${sym} last ${s.length} sessions · net foreign vol ${bars}`)
      })
      .catch(() => setSeriesTxt(`${sym}: lookup failed`))
  }

  return (
    <NexusLayout>
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-xl font-bold font-mono text-accent-cyan">BANDARMOLOGY — IDX FOREIGN FLOW</h1>
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
          {(["leaders", "streaks", "brokers"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1 text-[10px] font-mono uppercase rounded border transition-colors ${
                tab === t
                  ? "bg-teal-vivid text-bg-base border-teal-vivid font-bold"
                  : "bg-bg-panel border-border-dim text-text-muted hover:border-border-active"
              }`}>
              {t === "leaders" ? "Net Foreign" : t === "streaks" ? "Streaks ≥3d" : "Broker Board"}
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

        {seriesTxt && (
          <div className="bg-bg-panel border border-border-dim rounded-lg p-3 text-[11px] font-mono text-text-muted whitespace-pre-wrap break-all">
            {seriesTxt}
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
              <h3 className="text-xs font-mono text-accent-green mb-3">ACCUMULATION STREAKS</h3>
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
              <h3 className="text-xs font-mono text-accent-red mb-3">DISTRIBUTION STREAKS</h3>
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
            <h3 className="text-xs font-mono text-accent-cyan mb-3">TOP BROKERS BY TURNOVER</h3>
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-text-muted border-b border-border-dim">
                  <th className="text-left py-1">#</th>
                  <th className="text-left py-1">Firm</th>
                  <th className="text-right py-1">Value (Rp B)</th>
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
                    <td className="py-1 text-right">{fmtVol(b.volume)}</td>
                    <td className="py-1 text-right">{b.freq.toLocaleString("id-ID")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </NexusLayout>
  )
}
