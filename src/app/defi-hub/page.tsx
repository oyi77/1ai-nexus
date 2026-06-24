"use client"

import { useState } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import DeFiPage from '../defi/page'
import YieldsPage from '../yields/page'
import SectorsPage from '../sectors/page'
import RevenuePage from '../revenue/page'

const TABS = [
  { key: 'defi', label: '🏦 DeFi Overview' },
  { key: 'yields', label: '💧 Yield Farming' },
  { key: 'sectors', label: '📊 Sector Flows' },
  { key: 'revenue', label: '💰 Protocol Revenue' },
] as const

type TabKey = typeof TABS[number]['key']

export default function DefiHubPage() {
  const [tab, setTab] = useState<TabKey>('defi')

  return (
    <NexusLayout>
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-1 px-4 py-2 border-b border-bg-border bg-bg-panel shrink-0">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-1.5 text-[11px] font-mono rounded transition-colors ${
                tab === t.key
                  ? 'bg-teal-vivid text-bg-base font-bold'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-raised'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-auto">
          {tab === 'defi' && <DeFiPage />}
          {tab === 'yields' && <YieldsPage />}
          {tab === 'sectors' && <SectorsPage />}
          {tab === 'revenue' && <RevenuePage />}
        </div>
      </div>
    </NexusLayout>
  )
}
