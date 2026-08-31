"use client"

import { useCallback, useEffect, useState } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'

interface ApiKeyInfo {
  id: string
  name: string
  createdAt: string
}

interface AccountData {
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
  apiKeys: ApiKeyInfo[]
  plan: {
    label: string
    description: string
    features: string[]
    rateLimit: number
  } | null
  usage: { calls: number; limit: number }
}

export default function AccountPage() {
  const [data, setData] = useState<AccountData | null>(null)
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
      const d = (await res.json()) as { data: AccountData }
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
          <Panel title="Account">
            <p className="text-sm text-text-secondary">
              You need to sign in to view your account.
            </p>
            <a
              href="/login"
              className="inline-block mt-4 px-4 py-2 bg-teal-vivid text-bg-base font-mono font-bold rounded hover:bg-teal-vivid/80 transition-colors"
            >
              Sign In
            </a>
          </Panel>
        </div>
      </NexusLayout>
    )
  }

  const user = data?.user
  const planInfo = data?.plan
  const planLabel = user?.plan?.toUpperCase() ?? (data?.subscription?.plan.toUpperCase() ?? 'FREE')
  const planPrice = planInfo?.label ?? ''
  const usagePct = data ? Math.min(100, Math.round((data.usage.calls / Math.max(1, data.usage.limit)) * 100)) : 0

  return (
    <NexusLayout>
      <div className="max-w-4xl mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-text-primary">Account Settings</h1>
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <LiveDot status={status === 'live' ? 'live' : status === 'loading' ? 'stale' : 'error'} />
            <span>{user?.email ?? '…'}</span>
          </div>
        </div>

        {/* Current Plan */}
        <Panel title="Current Plan">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xl font-bold text-text-primary capitalize">{planLabel}</p>
              <p className="text-sm text-text-muted">{planPrice}</p>
              {data?.subscription?.endDate && (
                <p className="text-xs text-text-muted mt-1">
                  Renews {new Date(data.subscription.endDate).toLocaleDateString()}
                </p>
              )}
            </div>
            {planLabel !== 'ENTERPRISE' && (
              <a
                href="/pricing"
                className="px-4 py-2 bg-teal-vivid text-bg-base font-mono font-bold rounded hover:bg-teal-vivid/80 transition-colors"
              >
                {planLabel === 'FREE' ? 'Upgrade Plan' : 'Change Plan'}
              </a>
            )}
          </div>
          {planInfo?.features && (
            <ul className="mt-3 flex flex-wrap gap-2 text-xs text-text-secondary">
              {planInfo.features.map((f) => (
                <li key={f} className="px-2 py-0.5 bg-bg-raised rounded">{f}</li>
              ))}
            </ul>
          )}
        </Panel>

        {/* API Keys */}
        <Panel title="API Keys">
          {(data?.apiKeys?.length ?? 0) === 0 ? (
            <p className="text-sm text-text-muted">
              No API keys yet. <a href="/api-docs" className="text-teal-vivid">Read the docs</a> or create one.
            </p>
          ) : (
            <div className="space-y-2">
              {data!.apiKeys.map((k) => (
                <div key={k.id} className="flex items-center justify-between px-3 py-2 bg-bg-raised rounded">
                  <span className="font-mono text-sm text-text-primary">{k.name}</span>
                  <span className="text-xs text-text-muted">
                    {new Date(k.createdAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Usage */}
        <Panel title="Usage This Month">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">API Calls</span>
              <span className="font-mono text-text-primary">
                {data?.usage.calls ?? 0} / {data?.usage.limit ?? 100}
              </span>
            </div>
            <div className="h-2 bg-bg-raised rounded overflow-hidden">
              <div
                className={`h-full ${usagePct >= 90 ? 'bg-data-bear' : 'bg-teal-vivid'}`}
                style={{ width: `${usagePct}%` }}
              />
            </div>
          </div>
        </Panel>

        {/* Billing History */}
        <Panel title="Billing History">
          {planLabel === 'FREE' ? (
            <p className="text-sm text-text-muted">
              You are on the Free plan. No billing history.
            </p>
          ) : (
            <a
              href="/account/payments"
              className="text-sm text-teal-vivid hover:underline"
            >
              View your invoices and payment history →
            </a>
          )}
        </Panel>
      </div>
    </NexusLayout>
  )
}
