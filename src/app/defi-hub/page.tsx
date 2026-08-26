"use client"

import { useState } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { DeFiPageContent } from '../defi/page'
import { YieldsPageContent } from '../yields/content'
import { SectorsPageContent } from '../sectors/content'
import { RevenuePageContent } from '../revenue/page'

const TABS = [
  { key: 'defi', label: '🏦 DeFi Overview', content: DeFiPageContent },
  { key: 'yields', label: '💧 Yield Farming', content: YieldsPageContent },
  { key: 'sectors', label: '📊 Sector Flows', content: SectorsPageContent },
  { key: 'revenue', label: '💰 Revenue', content: RevenuePageContent },
] as const

type TabKey = typeof TABS[number]['key']

export default function DefiHubPage() {
  const [tab, setTab] = useState<TabKey>('defi')
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
