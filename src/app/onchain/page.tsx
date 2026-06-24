"use client"

import { useState } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import WhaleClusterPage from '../whale-cluster/page'
import SmartMoneyPage from '../smart-money/page'
import EntitiesPage from '../entities/page'
import MempoolPage from '../mempool/page'
import InsiderPage from '../insider/page'

const TABS = [
  { key: 'whale', label: '🐋 Whale Alerts' },
  { key: 'smart', label: '⚡ Smart Money' },
  { key: 'entities', label: '🏢 Entities' },
  { key: 'mempool', label: '📡 Mempool' },
  { key: 'insider', label: '🔍 Insider' },
] as const

type TabKey = typeof TABS[number]['key']

export default function OnchainHubPage() {
  const [tab, setTab] = useState<TabKey>('whale')

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
          {tab === 'whale' && <WhaleClusterPage />}
          {tab === 'smart' && <SmartMoneyPage />}
          {tab === 'entities' && <EntitiesPage />}
          {tab === 'mempool' && <MempoolPage />}
          {tab === 'insider' && <InsiderPage />}
        </div>
      </div>
    </NexusLayout>
  )
}
