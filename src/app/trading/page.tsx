"use client"

import { useState } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import ScannerPage from '../scanner/page'
import DexPage from '../dex/page'
import TrendingPage from '../trending/page'
import RugcheckPage from '../rugcheck/page'

const TABS = [
  { key: 'scanner', label: '🔍 Token Scanner' },
  { key: 'dex', label: '📊 DEX Monitor' },
  { key: 'trending', label: '🔥 Trending' },
  { key: 'rugcheck', label: '🛡 RugCheck' },
] as const

type TabKey = typeof TABS[number]['key']

export default function TradingPage() {
  const [tab, setTab] = useState<TabKey>('scanner')

  return (
    <NexusLayout>
      <div className="flex flex-col h-full">
        {/* Tab Bar */}
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

        {/* Tab Content */}
        <div className="flex-1 overflow-auto">
          {tab === 'scanner' && <ScannerPage />}
          {tab === 'dex' && <DexPage />}
          {tab === 'trending' && <TrendingPage />}
          {tab === 'rugcheck' && <RugcheckPage />}
        </div>
      </div>
    </NexusLayout>
  )
}
