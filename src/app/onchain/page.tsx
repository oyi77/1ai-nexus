"use client"

import { useState } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { WhaleClusterPageContent } from '../whale-cluster/content'
import { SmartMoneyPageContent } from '../smart-money/content'
import { EntitiesPageContent } from '../entities/page'
import { MempoolPageContent } from '../mempool/page'
import { InsiderPageContent } from '../insider/page'

const TABS = [
  { key: 'whale', label: '🐋 Whale Alerts', content: WhaleClusterPageContent },
  { key: 'smart', label: '⚡ Smart Money', content: SmartMoneyPageContent },
  { key: 'entities', label: '🏢 Entities', content: EntitiesPageContent },
  { key: 'mempool', label: '📡 Mempool', content: MempoolPageContent },
  { key: 'insider', label: '🔍 Insider', content: InsiderPageContent },
] as const

type TabKey = typeof TABS[number]['key']

export default function OnchainHubPage() {
  const [tab, setTab] = useState<TabKey>('whale')
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
