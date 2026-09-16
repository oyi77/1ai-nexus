"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { NexusLayout } from "@/components/layout/NexusLayout"
import { LiveDot } from "@/components/primitives/LiveDot"

interface CardState {
  title: string
  href: string
  lines: string[]
  error?: string
}

function Card({ title, href, lines, error }: CardState) {
  return (
    <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-text-secondary">{title}</h3>
        <Link href={href} className="text-xs text-accent-blue hover:text-accent-blue/80">Open →</Link>
      </div>
      {error ? (
        <p className="text-xs text-text-tertiary">{error}</p>
      ) : lines.length === 0 ? (
        <p className="text-xs text-text-tertiary">Loading…</p>
      ) : (
        <ul className="space-y-1">
          {lines.map((l, i) => (
            <li key={i} className="text-xs font-mono text-text-primary truncate">{l}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

const sign = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`

export default function MarketsHubPage() {
  const [loading, setLoading] = useState(true)
  const [cards, setCards] = useState<CardState[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const out: CardState[] = []
      const get = async (url: string): Promise<unknown> => {
        const r = await fetch(url)
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return (await r.json()).data
      }
      // IDX top gainers
      try {
        const d = (await get("/api/v1/saham/screener?top=gainers&limit=3")) as {
          items?: Array<{ symbol: string; change1d?: number }>
        }
        out.push({
          title: "IDX — TOP GAINERS",
          href: "/saham",
          lines: (d.items ?? []).map((s) => `${s.symbol} ${sign(s.change1d ?? 0)}`),
        })
      } catch { out.push({ title: "IDX — TOP GAINERS", href: "/saham", lines: [], error: "unavailable" }) }
      // IDX signals snapshot
      try {
        const d = (await get("/api/v1/saham/signals?view=rs&limit=3")) as {
          items?: Array<{ code: string; rsScore?: number }>
        }
        out.push({
          title: "IDX — RS LEADERS",
          href: "/saham-signals",
          lines: (d.items ?? []).map((s) => `${s.code} score ${(s.rsScore ?? 0).toFixed(0)}`),
        })
      } catch { out.push({ title: "IDX — RS LEADERS", href: "/saham-signals", lines: [], error: "unavailable" }) }
      // US stocks
      try {
        const d = (await get("/api/v1/equities/universe?market=us")) as {
          stocks?: Array<{ symbol: string; name?: string }>
        }
        out.push({
          title: "US STOCKS",
          href: "/equities?market=us",
          lines: (d.stocks ?? []).slice(0, 3).map((s) => `${s.symbol} ${s.name ?? ""}`.trim()),
        })
      } catch { out.push({ title: "US STOCKS", href: "/equities", lines: [], error: "unavailable" }) }
      // Commodities
      try {
        const d = (await get("/api/v1/commodities")) as {
          commodities?: Array<{ symbol: string; price?: number; changePct?: number }>
        }
        out.push({
          title: "COMMODITIES",
          href: "/commodities",
          lines: (d.commodities ?? []).slice(0, 3).map((c) => `${c.symbol} ${c.price ?? "—"} (${sign(c.changePct ?? 0)})`),
        })
      } catch { out.push({ title: "COMMODITIES", href: "/commodities", lines: [], error: "unavailable" }) }
      // Fear & greed
      try {
        const d = (await get("/api/v1/fear-greed")) as { composite?: { score?: number; label?: string } }
        out.push({
          title: "SENTIMENT",
          href: "/fear-greed",
          lines: [`Fear/Greed ${d.composite?.score ?? "—"} ${d.composite?.label ?? ""}`.trim()],
        })
      } catch { out.push({ title: "SENTIMENT", href: "/fear-greed", lines: [], error: "unavailable" }) }
      // Alpha feed
      try {
        const d = (await get("/api/v1/alpha-feed?limit=3")) as unknown
        const items: Array<{ asset?: string; symbol?: string; direction?: string }> = Array.isArray(d) ? d : []
        out.push({
          title: "ALPHA FEED",
          href: "/alpha",
          lines: items.map((a) => `${a.asset ?? a.symbol ?? "?"} ${a.direction ?? ""}`.trim()),
        })
      } catch { out.push({ title: "ALPHA FEED", href: "/alpha", lines: [], error: "unavailable" }) }
      if (!cancelled) {
        setCards(out)
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <NexusLayout>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 pt-6 pb-4 border-b border-border-dim">
          <div className="flex items-center gap-2">
            <LiveDot status={loading ? "stale" : "live"} label />
            <h1 className="text-xl font-semibold text-text-primary">Markets Hub</h1>
            <span className="text-xs text-text-tertiary">every instrument · live previews · deep links</span>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 content-start">
          {cards.map((c) => (
            <Card key={c.title} {...c} />
          ))}
        </div>
      </div>
    </NexusLayout>
  )
}
