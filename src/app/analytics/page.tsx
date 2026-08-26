"use client"

import { useState } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { AlphaEnginePageContent } from '../alpha-engine/page'
import { PredictionMarketsPageContent } from '../prediction-markets/page'
import { PredictionsPageContent } from '../predictions/page'

const TABS = [
  { key: 'alpha', label: '🧠 Alpha Engine', content: AlphaEnginePageContent },
  { key: 'markets', label: '🎯 Prediction Markets', content: PredictionMarketsPageContent },
  { key: 'paper', label: '📝 Paper Trading', content: PredictionsPageContent },
] as const

type TabKey = typeof TABS[number]['key']

export default function AnalyticsHubPage() {
  const [tab, setTab] = useState<TabKey>('alpha')
  const active = TABS.find(t => t.key === tab)!

  return (
    <NexusLayout>
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-1 px-4 py-2 border-b border-bg-border bg-bg-panel shrink-0">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-1.5 text-xs font-mono rounded transition-colors ${tab === t.key ? 'bg-teal-vivid text-bg-base font-bold' : 'text-text-muted hover:text-text-primary hover:bg-bg-raised'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-auto">
          <active.content />
        </div>
      </div>
    </NexusLayout>
  )
}
