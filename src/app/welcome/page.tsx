"use client"

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'

interface WelcomeData {
  user: {
    id: string
    email: string
    role: string
    plan: string
    planStartedAt: string | null
    planExpiresAt: string | null
    apiUsageCount: number
    createdAt: string
  }
  subscription: {
    status: string
    plan: string
    startDate: string
    endDate: string
  } | null
  plan: {
    label: string
    description: string
    features: string[]
    rateLimit: number
  } | null
}

const STEPS = [
  {
    n: '01',
    title: 'Connect data sources',
    body: 'Link your exchanges and data feeds to stream live prices, funding rates, and sentiment into one view.',
  },
  {
    n: '02',
    title: 'Explore the terminal',
    body: 'Browse markets, arbitrage spreads, copy-trading leaders, and on-chain signals across every dashboard.',
  },
  {
    n: '03',
    title: 'Upgrade for signals',
    body: 'Unlock automated alerts and actionable trading signals with a paid plan when you are ready.',
  },
] as const

export default function WelcomePage() {
  const [data, setData] = useState<WelcomeData | null>(null)
  const [status, setStatus] = useState<'loading' | 'live' | 'error' | 'unauthenticated'>('loading')

  const fetchAccount = useCallback(async () => {
    setStatus('loading')
    try {
      const res = await fetch('/api/v1/account/me')
      if (res.status === 401) {
        setStatus('unauthenticated')
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = (await res.json()) as { data: WelcomeData }
      setData(d.data)
      setStatus('live')
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAccount()
  }, [fetchAccount])

  if (status === 'unauthenticated') {
    return (
      <NexusLayout>
        <div className="max-w-4xl mx-auto p-6">
          <Panel title="Welcome to Nexus">
            <p className="text-sm text-text-secondary">
              You need to sign in to get started.
            </p>
            <Link
              href="/login"
              className="inline-block mt-4 px-4 py-2 bg-teal-vivid text-bg-base font-mono font-bold rounded hover:bg-teal-vivid/80 transition-colors"
            >
              Sign In
            </Link>
          </Panel>
        </div>
      </NexusLayout>
    )
  }

  const user = data?.user
  const planInfo = data?.plan
  const planLabel = user?.plan?.toUpperCase() ?? (data?.subscription?.plan.toUpperCase() ?? 'FREE')
  const features = planInfo?.features ?? []

  return (
    <NexusLayout>
      <div className="max-w-4xl mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-text-primary">Welcome to Nexus</h1>
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <LiveDot status={status === 'live' ? 'live' : status === 'loading' ? 'stale' : 'error'} />
            <span>{user?.email ?? '…'}</span>
          </div>
        </div>

        <div className="grid gap-8 md:grid-cols-2">
          {/* Get started guide */}
          <Panel title="Get Started">
            <ol className="space-y-4 p-3">
              {STEPS.map((step) => (
                <li key={step.n} className="flex gap-3">
                  <span className="font-mono text-teal-vivid text-sm shrink-0 mt-0.5">{step.n}</span>
                  <div>
                    <p className="text-sm font-medium text-text-primary">{step.title}</p>
                    <p className="text-xs text-text-secondary mt-0.5">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-3 px-3 pb-3">
              <Link
                href="/"
                className="px-4 py-2 bg-teal-vivid text-bg-base font-mono font-bold rounded hover:bg-teal-vivid/80 transition-colors"
              >
                Explore the Terminal
              </Link>
              <Link
                href="/pricing"
                className="px-4 py-2 border border-bg-border text-text-primary font-mono font-bold rounded hover:bg-bg-raised transition-colors"
              >
                View Pricing
              </Link>
            </div>
          </Panel>

          {/* Current plan */}
          <Panel title="Your Plan">
            <div className="p-3">
              <p className="text-xl font-bold text-text-primary capitalize">{planLabel}</p>
              {planInfo?.description && (
                <p className="text-sm text-text-muted mt-1">{planInfo.description}</p>
              )}
              {features.length > 0 && (
                <>
                  <p className="text-xs text-text-muted mt-4 mb-2">Included features</p>
                  <ul className="flex flex-wrap gap-2 text-xs text-text-secondary">
                    {features.map((f) => (
                      <li key={f} className="px-2 py-0.5 bg-bg-raised rounded">{f}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </NexusLayout>
  )
}
