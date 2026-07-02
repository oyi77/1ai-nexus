"use client"

import { useState } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'

export default function AccountPage() {
  const [currentPlan] = useState('free') // Would come from API
  const [apiKey] = useState('nexus-dev-key') // Would come from API

  const plans = [
    { id: 'free', name: 'Free', price: '$0/mo', features: ['100 API calls/day', 'Basic market data'] },
    { id: 'pro', name: 'Pro', price: '$29/mo', features: ['10,000 API calls/day', 'All signals', 'Backtest'] },
    { id: 'enterprise', name: 'Enterprise', price: '$99/mo', features: ['100,000 API calls/day', 'WebSocket', 'Priority support'] },
  ]

  return (
    <NexusLayout>
      <div className="max-w-4xl mx-auto p-6 space-y-8">
        <h1 className="text-2xl font-bold font-mono text-text-primary">Account Settings</h1>

        {/* Current Plan */}
        <div className="bg-bg-panel border border-border-dim rounded-lg p-6">
          <h2 className="text-lg font-bold font-mono text-accent-cyan mb-4">Current Plan</h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xl font-bold font-mono text-text-primary capitalize">{currentPlan}</p>
              <p className="text-sm text-text-muted font-mono">
                {plans.find(p => p.id === currentPlan)?.price}
              </p>
            </div>
            {currentPlan !== 'enterprise' && (
              <a
                href="/pricing"
                className="px-4 py-2 bg-teal-vivid text-bg-base font-mono font-bold rounded hover:bg-teal-vivid/80 transition-colors"
              >
                Upgrade Plan
              </a>
            )}
          </div>
        </div>

        {/* API Key */}
        <div className="bg-bg-panel border border-border-dim rounded-lg p-6">
          <h2 className="text-lg font-bold font-mono text-accent-cyan mb-4">API Key</h2>
          <div className="flex items-center gap-4">
            <code className="flex-1 px-4 py-2 bg-bg-raised rounded font-mono text-sm text-text-primary">
              {apiKey.slice(0, 8)}...{apiKey.slice(-4)}
            </code>
            <button className="px-4 py-2 bg-bg-raised text-text-muted font-mono rounded hover:text-text-primary transition-colors">
              Copy
            </button>
          </div>
          <p className="text-xs text-text-muted font-mono mt-2">
            Use this key in your API requests: <code>Authorization: Bearer {apiKey.slice(0, 8)}...</code>
          </p>
        </div>

        {/* Usage */}
        <div className="bg-bg-panel border border-border-dim rounded-lg p-6">
          <h2 className="text-lg font-bold font-mono text-accent-cyan mb-4">Usage This Month</h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-text-muted font-mono">API Calls</p>
              <p className="text-xl font-bold font-mono text-text-primary">42 / 100</p>
            </div>
            <div>
              <p className="text-sm text-text-muted font-mono">Signals Stored</p>
              <p className="text-xl font-bold font-mono text-text-primary">15</p>
            </div>
            <div>
              <p className="text-sm text-text-muted font-mono">Backtests Run</p>
              <p className="text-xl font-bold font-mono text-text-primary">3</p>
            </div>
          </div>
        </div>

        {/* Billing History */}
        <div className="bg-bg-panel border border-border-dim rounded-lg p-6">
          <h2 className="text-lg font-bold font-mono text-accent-cyan mb-4">Billing History</h2>
          <p className="text-sm text-text-muted font-mono">
            {currentPlan === 'free'
              ? 'You are on the Free plan. No billing history.'
              : 'View your invoices and payment history.'}
          </p>
        </div>
      </div>
    </NexusLayout>
  )
}
