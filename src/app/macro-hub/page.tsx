"use client"

import { useState } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import MacroPage from '../macro/page'
import CalendarPage from '../calendar/page'
import NewsPage from '../news/page'
import CorrelationsPage from '../correlations/page'

const TABS = [
  { key: 'macro', label: '🏛 Macro' },
  { key: 'news', label: '📰 News Feed' },
  { key: 'calendar', label: '📅 Calendar' },
  { key: 'correlations', label: '🔗 Correlations' },
] as const

type TabKey = typeof TABS[number]['key']

export default function MacroHubPage() {
  const [tab, setTab] = useState<TabKey>('macro')

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
          {tab === 'macro' && <MacroPage />}
          {tab === 'news' && <NewsPage />}
          {tab === 'calendar' && <CalendarPage />}
          {tab === 'correlations' && <CorrelationsPage />}
        </div>
      </div>
    </NexusLayout>
  )
}
