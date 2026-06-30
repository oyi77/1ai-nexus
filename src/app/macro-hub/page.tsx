"use client"

import { useState } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { MacroCommandCenterContent } from '../macro/page'
import { NewsPageContent } from '../news/page'
import { CalendarPageContent } from '../calendar/page'
import { CorrelationsPageContent } from '../correlations/page'
import { IndonesiaMacroContent } from '../indonesia-macro/page'

const TABS = [
  { key: 'macro', label: '🏛 Macro', content: MacroCommandCenterContent },
  { key: 'indonesia', label: '🇮🇩 Indonesia', content: IndonesiaMacroContent },
  { key: 'news', label: '📰 News Feed', content: NewsPageContent },
  { key: 'calendar', label: '📅 Calendar', content: CalendarPageContent },
  { key: 'correlations', label: '🔗 Correlations', content: CorrelationsPageContent },
] as const

type TabKey = typeof TABS[number]['key']

export default function MacroHubPage() {
  const [tab, setTab] = useState<TabKey>('macro')
  const active = TABS.find(t => t.key === tab)!

  return (
    <NexusLayout>
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-1 px-4 py-2 border-b border-bg-border bg-bg-panel shrink-0">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-1.5 text-[11px] font-mono rounded transition-colors ${tab === t.key ? 'bg-teal-vivid text-bg-base font-bold' : 'text-text-muted hover:text-text-primary hover:bg-bg-raised'}`}>
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
