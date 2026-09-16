"use client"

import { useState } from "react"
import { NexusLayout } from "@/components/layout/NexusLayout"
import { LiveDot } from "@/components/primitives/LiveDot"
import IdeasView from "@/components/saham/IdeasView"
import SignalsView from "@/components/saham/SignalsView"
import BandarmologyView from "@/components/saham/BandarmologyView"

const TABS = [["ideas", "IDEAS"], ["signals", "SIGNALS"], ["bandar", "BANDARMOLOGY"]] as const
type Tab = (typeof TABS)[number][0]

export default function SahamHubPage() {
  const [tab, setTab] = useState<Tab>("ideas")
  const [query, setQuery] = useState("")

  return (
    <NexusLayout>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 pt-6 pb-4 border-b border-border-dim">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2">
              <LiveDot status="live" /> IDX Saham Hub
            </h1>
            <span className="text-xs text-text-tertiary">unified · ideas + signals + bandarmology</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-4">
            <div className="flex gap-2">
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
            </div>
            <input
              type="text"
              placeholder="Filter instrument — code or name, all tabs..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="bg-bg-panel border border-border-dim rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-blue w-72"
            />
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          {tab === "ideas" && <IdeasView externalQuery={query} />}
          {tab === "signals" && <SignalsView externalQuery={query} />}
          {tab === "bandar" && <BandarmologyView externalQuery={query} />}
        </div>
      </div>
    </NexusLayout>
  )
}
