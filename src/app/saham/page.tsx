"use client"

import { useState } from "react"
import { useQueryParams } from "@/components/primitives/useQueryParams"
import { NexusLayout } from "@/components/layout/NexusLayout"
import { LiveDot } from "@/components/primitives/LiveDot"
import IdeasView from "@/components/saham/IdeasView"
import SignalsView from "@/components/saham/SignalsView"
import BandarmologyView from "@/components/saham/BandarmologyView"
import MarketsView from "@/components/saham/MarketsView"

const TABS = ["ideas", "signals", "bandar", "markets"] as const
type Tab = (typeof TABS)[number]

const TAB_LABELS: Record<Tab, string> = {
  ideas: "IDEAS",
  signals: "SIGNALS",
  bandar: "BANDARMOLOGY",
  markets: "MARKETS",
}

const isTab = (value: string | null): value is Tab =>
  value !== null && (TABS as readonly string[]).includes(value)

export default function SahamHubPage() {
  const query = useQueryParams()
  const shown = query.get("tab")
  const [tab, setTab] = useState<Tab>(isTab(shown) ? shown : "ideas")
  const [filter, setFilter] = useState("")

  return (
    <NexusLayout>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 pt-6 pb-4 border-b border-border-dim">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2">
              <LiveDot status="live" /> IDX Saham Hub
            </h1>
            <span className="text-xs text-text-tertiary">unified · ideas + signals + bandarmology + markets</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-4">
            <div className="flex gap-2">
              {TABS.map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  aria-pressed={tab === t}
                  className={`inline-flex items-center justify-center h-9 px-3 text-xs font-mono uppercase rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/70 ${
                    tab === t
                      ? "bg-teal-vivid text-bg-base border-teal-vivid font-bold"
                      : "bg-bg-panel border-border-dim text-text-muted hover:border-border-active"
                  }`}>
                  {TAB_LABELS[t]}
                </button>
              ))}
            </div>
            <input
              type="text"
              placeholder="Filter instrument — code or name, all tabs..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="bg-bg-panel border border-border-dim rounded-lg px-3 h-9 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-blue w-72"
            />
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          {tab === "ideas" && <IdeasView externalQuery={filter} />}
          {tab === "signals" && <SignalsView externalQuery={filter} limit={1000} />}
          {tab === "bandar" && <BandarmologyView externalQuery={filter} limit={100} />}
          {tab === "markets" && <MarketsView externalQuery={filter} />}
        </div>
      </div>
    </NexusLayout>
  )
}
