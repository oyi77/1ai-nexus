"use client"

import { useState } from 'react'
import Link from 'next/link'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { AlphaEnginePageContent } from '../alpha-engine/content'
import { PredictionsMarketsContent } from '../predictions/markets'
import { ForecastPaper } from '@/lib/predictions/forecast-paper'
import { ForecastTape } from '@/lib/predictions/forecast-tape'
import { ForecastBoard } from '@/lib/predictions/forecast-board'

const TABS = [
  { key: 'alpha', label: 'ALPHA ENGINE', content: AlphaEnginePageContent },
  { key: 'markets', label: 'FORECAST MARKETS', content: PredictionsMarketsContent },
  { key: 'paper', label: 'PAPER', content: ForecastPaper },
  { key: 'tape', label: 'TAPE', content: ForecastTape },
  { key: 'board', label: 'BOARD', content: ForecastBoard },
] as const

type TabKey = typeof TABS[number]['key']

export default function AnalyticsHubPage() {
  const [tab, setTab] = useState<TabKey>('alpha')
  const active = TABS.find(t => t.key === tab)!

  return (
    <NexusLayout>
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-1 px-4 py-2 border-b border-bg-border bg-bg-panel shrink-0 flex-wrap">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              aria-pressed={tab === t.key}
              className={`inline-flex items-center justify-center h-9 px-3 text-xs font-mono rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/70 ${tab === t.key ? 'bg-teal-vivid text-bg-base font-bold' : 'text-text-muted hover:text-text-primary hover:bg-bg-raised'}`}>
              {t.label}
            </button>
          ))}
          <div className="flex-1" />
          <Link
            href="/predictions"
            className="inline-flex items-center justify-center h-9 px-3 text-xs font-mono text-text-muted hover:text-text-primary transition-colors"
          >
            Open Forecast Hub
          </Link>
        </div>
        <div className="flex-1 overflow-auto">
          <active.content />
        </div>
      </div>
    </NexusLayout>
  )
}
