"use client"

import { useState, useEffect } from "react"

type RSRow = { code: string; name: string; rs4w: number | null; rs13w: number | null; rsScore: number }
type BreakoutRow = { code: string; name: string; price: number; high52w: number; distancePct: number }
type BandarRow = { code: string; accdist: string; top1Amount: number | null; foreignStreakDays: number; foreignStreakDir: string | null }


const signCls = (v: number | null) =>
  v === null ? "text-text-muted" : v >= 0 ? "text-accent-green" : "text-accent-red"
const fmtPp = (v: number | null) =>
  v === null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}`
const fmtIdr = (v: number | null) =>
  v === null ? "—" : `${v < 0 ? "-" : ""}Rp${(Math.abs(v) / 1e9).toFixed(1)}B`

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-bg-panel border border-border-dim rounded-lg p-4 overflow-x-auto">
      <h3 className="text-xs font-semibold text-text-secondary mb-3">{title}</h3>
      {children}
    </div>
  )
}

const TABS = [["rs", "RS CHECK"], ["breakout", "BREAKOUT"], ["ara", "ARA PROX"], ["bandar", "BANDAR FLOW"]] as const
type Tab = (typeof TABS)[number][0]
type ARARow = { code: string; name: string; prev: number; close: number; ara: number; proximityPct: number }

const matchesQuery = (q: string, ...fields: (string | null | undefined)[]): boolean => {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return fields.some(f => (f ?? '').toLowerCase().includes(needle))
}

export default function SignalsView({ externalQuery, limit = 25 }: { externalQuery?: string; limit?: number }) {
  const [tab, setTab] = useState<Tab>("rs")
  const [rs, setRs] = useState<RSRow[]>([])
  const [rsMeta, setRsMeta] = useState<{ median4w?: number; median13w?: number }>({})
  const [breakout, setBreakout] = useState<BreakoutRow[]>([])
  const [bandar, setBandar] = useState<BandarRow[]>([])
  const [ara, setAra] = useState<ARARow[]>([])
  const [araDate, setAraDate] = useState<string>("")

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (tab === "rs") {
          const d = await (await fetch(`/api/v1/saham/signals?view=rs&limit=${limit}`)).json()
          if (!cancelled) {
            setRs(d.data?.items ?? [])
            setRsMeta({ median4w: d.data?.median4w, median13w: d.data?.median13w })
          }
        } else if (tab === "breakout") {
          const d = await (await fetch(`/api/v1/saham/signals?view=breakout&limit=${limit}`)).json()
          if (!cancelled) setBreakout(d.data?.items ?? [])
        } else if (tab === "ara") {
          const d = await (await fetch(`/api/v1/saham/signals?view=ara&limit=${limit}`)).json()
          if (!cancelled) {
            setAra(d.data?.items ?? [])
            setAraDate(d.data?.tradeDate ?? "")
          }
        } else {
          const d = await (await fetch(`/api/v1/saham/signals?view=bandar&limit=${limit}`)).json()
          if (!cancelled) setBandar(d.data?.items ?? [])
        }
      } catch { /* leave previous */ }
    })()
    return () => { cancelled = true }
  }, [tab, limit])

  return (
    <>

      <div className="flex gap-2 mb-4">
        {TABS.map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1 text-xs font-mono uppercase rounded border transition-colors ${
              tab === t
                ? "bg-teal-vivid text-bg-base border-teal-vivid font-bold"
                : "bg-bg-panel border-border-dim text-text-muted hover:border-border-active"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "rs" && (
        <Panel title={`RELATIVE STRENGTH vs UNIVERSE (med 4w ${fmtPp(rsMeta.median4w ?? null)}pp · 13w ${fmtPp(rsMeta.median13w ?? null)}pp)`}>
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-text-muted border-b border-border-dim">
                <th className="text-left py-1">Code</th>
                <th className="text-left py-1">Name</th>
                <th className="text-right py-1">RS 4w (pp)</th>
                <th className="text-right py-1">RS 13w (pp)</th>
                <th className="text-right py-1">Score</th>
              </tr>
            </thead>
            <tbody>
              {rs.filter((r) => matchesQuery(externalQuery ?? "", r.code, r.name)).map((r) => (
                <tr key={r.code} className="border-b border-border-dim/30">
                  <td className="py-1 font-mono font-semibold text-teal-vivid">{r.code}</td>
                  <td className="py-1 truncate max-w-40">{r.name}</td>
                  <td className={`py-1 text-right ${signCls(r.rs4w)}`}>{fmtPp(r.rs4w)}</td>
                  <td className={`py-1 text-right ${signCls(r.rs13w)}`}>{fmtPp(r.rs13w)}</td>
                  <td className="py-1 text-right font-mono">{r.rsScore.toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {tab === "breakout" && (
        <Panel title="NEAR 52W HIGH (within 5%)">
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-text-muted border-b border-border-dim">
                <th className="text-left py-1">Code</th>
                <th className="text-left py-1">Name</th>
                <th className="text-right py-1">Price</th>
                <th className="text-right py-1">52w High</th>
                <th className="text-right py-1">Distance</th>
              </tr>
            </thead>
            <tbody>
              {breakout.filter((r) => matchesQuery(externalQuery ?? "", r.code, r.name)).map((r) => (
                <tr key={r.code} className="border-b border-border-dim/30">
                  <td className="py-1 font-mono font-semibold text-teal-vivid">{r.code}</td>
                  <td className="py-1 truncate max-w-40">{r.name}</td>
                  <td className="py-1 text-right">{r.price.toLocaleString("id-ID")}</td>
                  <td className="py-1 text-right">{r.high52w.toLocaleString("id-ID")}</td>
                  <td className="py-1 text-right text-accent-cyan">{r.distancePct.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {tab === "ara" && (
        <Panel title={`ARA PROXIMITY — ROOM TO LIMIT-UP (session ${araDate})`}>
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-text-muted border-b border-border-dim">
                <th className="text-left py-1">Code</th>
                <th className="text-left py-1">Name</th>
                <th className="text-right py-1">Prev</th>
                <th className="text-right py-1">Close</th>
                <th className="text-right py-1">ARA</th>
                <th className="text-right py-1">Room</th>
              </tr>
            </thead>
            <tbody>
              {ara.filter((r) => matchesQuery(externalQuery ?? "", r.code, r.name)).map((r) => (
                <tr key={r.code} className="border-b border-border-dim/30">
                  <td className="py-1 font-mono font-semibold text-teal-vivid">{r.code}</td>
                  <td className="py-1 truncate max-w-40">{r.name}</td>
                  <td className="py-1 text-right">{r.prev.toLocaleString("id-ID")}</td>
                  <td className="py-1 text-right">{r.close.toLocaleString("id-ID")}</td>
                  <td className="py-1 text-right">{r.ara.toLocaleString("id-ID")}</td>
                  <td className="py-1 text-right text-accent-cyan">+{r.proximityPct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {tab === "bandar" && (
        <Panel title="BANDAR FLOW — ACCUMULATION × FOREIGN STREAK">
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-text-muted border-b border-border-dim">
                <th className="text-left py-1">Code</th>
                <th className="text-left py-1">Bandar</th>
                <th className="text-right py-1">Top-1 Net</th>
                <th className="text-right py-1">Foreign Streak</th>
              </tr>
            </thead>
            <tbody>
              {bandar.filter((r) => matchesQuery(externalQuery ?? "", r.code)).map((r) => (
                <tr key={r.code} className="border-b border-border-dim/30">
                  <td className="py-1 font-mono font-semibold text-teal-vivid">{r.code}</td>
                  <td className="py-1">{r.accdist}</td>
                  <td className={`py-1 text-right ${signCls(r.top1Amount)}`}>{fmtIdr(r.top1Amount)}</td>
                  <td className="py-1 text-right">{r.foreignStreakDir ?? "—"}{r.foreignStreakDays > 0 ? ` ${r.foreignStreakDays}d` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  )
}