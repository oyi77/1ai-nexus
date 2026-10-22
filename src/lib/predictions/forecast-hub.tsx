"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { NexusLayout } from "@/components/layout/NexusLayout"
import { LiveDot } from "@/components/primitives/LiveDot"
import { PredictionsMarketsContent } from "@/app/predictions/markets"
import { ForecastPaper } from "@/lib/predictions/forecast-paper"
import { ForecastTape } from "@/lib/predictions/forecast-tape"
import { ForecastBoard } from "@/lib/predictions/forecast-board"

const TABS = ["markets", "paper", "tape", "board"] as const
type Tab = (typeof TABS)[number]

const TAB_LABELS: Record<Tab, string> = {
  markets: "MARKETS",
  paper: "PAPER",
  tape: "TAPE",
  board: "BOARD",
}

const isTab = (value: string | undefined): value is Tab =>
  typeof value === "string" && (TABS as readonly string[]).includes(value)

export function ForecastHub({ initialTab }: { initialTab?: string }) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>(isTab(initialTab) ? initialTab : "markets")

  const selectTab = (next: Tab) => {
    setTab(next)
    router.replace(`/predictions?tab=${next}`, { scroll: false })
  }

  return (
    <NexusLayout>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 pt-6 pb-4 border-b border-border-dim">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2">
              <LiveDot status="live" /> Forecast Hub
            </h1>
            <span className="text-xs text-text-tertiary">unified · markets + paper + tape + board</span>
          </div>
          <div className="flex gap-2 mt-4" role="tablist" aria-label="Forecast surfaces">
            {TABS.map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => selectTab(t)}
                className={`inline-flex items-center justify-center h-9 px-3 text-xs font-mono uppercase rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/70 ${
                  tab === t
                    ? "bg-teal-vivid text-bg-base border-teal-vivid font-bold"
                    : "bg-bg-panel border-border-dim text-text-muted hover:border-border-active"
                }`}
              >
                {TAB_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          {tab === "markets" && <PredictionsMarketsContent />}
          {tab === "paper" && <ForecastPaper />}
          {tab === "tape" && <ForecastTape />}
          {tab === "board" && <ForecastBoard />}
        </div>
      </div>
    </NexusLayout>
  )
}
