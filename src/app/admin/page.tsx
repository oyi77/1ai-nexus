"use client"

import { useCallback, useEffect, useState } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'

interface AdminStats {
  users?: number
  activeKeys?: number
  plans?: Record<string, number>
}

interface AnalyticsData {
  dau: number
  mau: number
  total: number
  topPages: Array<{ path: string; count: number }>
}

interface ApiKeyInfo {
  id: string
  name: string
  createdAt: string
}

interface AdminUser {
  id: string
  email: string
  plan: string
  createdAt: string
}

interface IntegrationInfo {
  key: string
  label: string
  staged: boolean
  updatedAt: string | null
  healthy: boolean
}

interface AccountData {
  user: {
    id: string
    email: string
    role: string
    plan: string
    createdAt: string
  }
}

type PageStatus = 'loading' | 'live' | 'error' | 'unauthenticated' | 'denied'

export default function AdminPage() {
  const [userData, setUserData] = useState<AccountData | null>(null)
  const [status, setStatus] = useState<PageStatus>('loading')

  const [stats, setStats] = useState<AdminStats | null>(null)
  const [statsError, setStatsError] = useState(false)

  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null)
  const [keysError, setKeysError] = useState(false)
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [usersError, setUsersError] = useState(false)
  const [integrations, setIntegrations] = useState<IntegrationInfo[] | null>(null)
  const [integrationsError, setIntegrationsError] = useState(false)
  const [tokenInput, setTokenInput] = useState('')
  const [tokenBusy, setTokenBusy] = useState(false)
  const [tokenMsg, setTokenMsg] = useState<string | null>(null)
  const [refundId, setRefundId] = useState('')
  const [refundReason, setRefundReason] = useState('')
  const [refundBusy, setRefundBusy] = useState(false)
  const [refundMsg, setRefundMsg] = useState<string | null>(null)
  const [analyticsError, setAnalyticsError] = useState(false)

  const fetchAll = useCallback(async () => {
    setStatus('loading')
    try {
      const meRes = await fetch('/api/v1/account/me')
      if (meRes.status === 401) {
        setStatus('unauthenticated')
        return
      }
      if (!meRes.ok) throw new Error(`HTTP ${meRes.status}`)
      const me = (await meRes.json()) as { data: AccountData }
      const user = me.data?.user

      if (!user || user.role !== 'admin') {
        setUserData(me.data)
        setStatus('denied')
        return
      }

      setUserData(me.data)
      setStatus('live')

      // Fetch admin stats (may 404 — tolerate gracefully)
      try {
        const statsRes = await fetch('/api/v1/admin/stats')
        if (statsRes.ok) {
          const statsJson = (await statsRes.json()) as { data: AdminStats }
          setStats(statsJson.data ?? null)
        } else {
          setStats(null)
          setStatsError(true)
        }
      } catch {
        setStats(null)
        setStatsError(true)
      }

      // Fetch API keys
      try {
        const keysRes = await fetch('/api/v1/keys')
        if (keysRes.ok) {
          const keysJson = (await keysRes.json()) as { data: { keys: ApiKeyInfo[] } }
          setKeys(keysJson.data?.keys ?? null)
        } else {
          setKeys(null)
          setKeysError(true)
        }
      } catch {
        setKeys(null)
        setKeysError(true)
      }

      // Fetch analytics (DAU/MAU)
      try {
        const analyticsRes = await fetch('/api/v1/analytics')
        if (analyticsRes.ok) {
          const analyticsJson = (await analyticsRes.json()) as { data: AnalyticsData }
          setAnalytics(analyticsJson.data ?? null)
        } else {
          setAnalytics(null)
          setAnalyticsError(true)
        }
      } catch {
        setAnalytics(null)
        setAnalyticsError(true)
      }

      // Fetch users (admin directory)
      try {
        const usersRes = await fetch('/api/v1/admin/users')
        if (usersRes.ok) {
          const usersJson = (await usersRes.json()) as { data: { users: AdminUser[] } }
          setUsers(usersJson.data?.users ?? null)
        } else {
          setUsers(null)
          setUsersError(true)
        }
      } catch {
        setUsers(null)
        setUsersError(true)
      }

      // Fetch integrations (admin secrets)
      try {
        const intRes = await fetch('/api/v1/admin/integrations')
        if (intRes.ok) {
          const intJson = (await intRes.json()) as { data: { items: IntegrationInfo[] } }
          setIntegrations(intJson.data?.items ?? null)
        } else {
          setIntegrations(null)
          setIntegrationsError(true)
        }
      } catch {
        setIntegrations(null)
        setIntegrationsError(true)
      }
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAll()
  }, [fetchAll])

  // ── Unauthenticated ──
  if (status === 'unauthenticated') {
    return (
      <NexusLayout>
        <div className="max-w-4xl mx-auto p-6">
          <Panel title="Admin Panel">
            <p className="text-sm text-text-secondary">
              You need to sign in to access the admin panel.
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

  // ── Denied (authenticated but not admin) ──
  if (status === 'denied') {
    return (
      <NexusLayout>
        <div className="max-w-4xl mx-auto p-6">
          <Panel title="Admin Panel">
            <p className="text-sm text-text-secondary font-mono">
              Access denied — admin only
            </p>
          </Panel>
        </div>
      </NexusLayout>
    )
  }

  // ── Error ──
  if (status === 'error') {
    return (
      <NexusLayout>
        <div className="max-w-4xl mx-auto p-6">
          <Panel title="Admin Panel">
            <p className="text-sm text-data-bear font-mono">
              Failed to load admin panel. Please try again.
            </p>
          </Panel>
        </div>
      </NexusLayout>
    )
  }

  // ── Loading ──
  if (status === 'loading') {
    return (
      <NexusLayout>
        <div className="max-w-4xl mx-auto p-6">
          <Panel title="Admin Panel">
            <p className="text-sm text-text-muted font-mono">Loading…</p>
          </Panel>
        </div>
      </NexusLayout>
    )
  }

  // ── Live ──
  async function stageToken() {
    const value = tokenInput.trim()
    if (!value) {
      setTokenMsg('Paste a refresh token first.')
      return
    }
    setTokenBusy(true)
    setTokenMsg(null)
    try {
      const res = await fetch('/api/v1/admin/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'stockbit_refresh_token', value }),
      })
      const json = (await res.json()) as { data: { ok?: boolean } | null; error: string | null }
      if (res.ok && json.data?.ok) {
        setTokenInput('')
        setTokenMsg('Token staged — rotated pair saved encrypted.')
      } else {
        setTokenMsg(json.error ?? 'Staging failed.')
      }
    } catch {
      setTokenMsg('Network error while staging.')
    } finally {
      setTokenBusy(false)
      // Refresh the list (value never re-fetched — only status)
      try {
        const intRes = await fetch('/api/v1/admin/integrations')
        if (intRes.ok) {
          const intJson = (await intRes.json()) as { data: { items: IntegrationInfo[] } }
          setIntegrations(intJson.data?.items ?? null)
        }
      } catch {
        // keep previous list
      }
    }
  }

  async function revokeToken(key: string) {
    setTokenBusy(true)
    setTokenMsg(null)
    try {
      const res = await fetch(`/api/v1/admin/integrations?key=${encodeURIComponent(key)}`, { method: 'DELETE' })
      const json = (await res.json()) as { data: unknown; error: string | null }
      setTokenMsg(res.ok ? 'Token revoked.' : (json.error ?? 'Revoke failed.'))
      if (res.ok) {
        const intRes = await fetch('/api/v1/admin/integrations')
        if (intRes.ok) {
          const intJson = (await intRes.json()) as { data: { items: IntegrationInfo[] } }
          setIntegrations(intJson.data?.items ?? null)
        }
      }
    } catch {
      setTokenMsg('Network error while revoking.')
    } finally {
      setTokenBusy(false)
    }
  }

  const statItems: { label: string; value: string | number }[] = []

  if (stats) {
    if (typeof stats.users === 'number') statItems.push({ label: 'Users', value: stats.users })
    if (typeof stats.activeKeys === 'number') statItems.push({ label: 'Active Keys', value: stats.activeKeys })
    if (stats.plans && typeof stats.plans === 'object') {
      const planCount = Object.keys(stats.plans).length
      statItems.push({ label: 'Plans', value: planCount })
    }
  }

  return (
    <NexusLayout>
      <div className="max-w-4xl mx-auto p-6 space-y-8">
        {/* Heading */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-text-primary">Admin Panel</h1>
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <LiveDot status="live" size={5} />
            <span className="font-mono">{userData?.user?.email ?? '…'}</span>
          </div>
        </div>

        {/* Stats Grid */}
        <Panel
          title="Overview"
          liveStatus={statsError ? 'error' : stats ? 'live' : 'stale'}
        >
          {statItems.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4">
              {statItems.map((item) => (
                <div
                  key={item.label}
                  className="flex flex-col gap-1 p-4 bg-bg-raised rounded"
                >
                  <span className="text-xs text-text-muted font-mono uppercase tracking-wider">
                    {item.label}
                  </span>
                  <span className="text-2xl font-bold text-text-primary font-mono">
                    {item.value}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4">
              {['Users', 'Active Keys', 'Plans'].map((label) => (
                <div
                  key={label}
                  className="flex flex-col gap-1 p-4 bg-bg-raised rounded"
                >
                  <span className="text-xs text-text-muted font-mono uppercase tracking-wider">
                    {label}
                  </span>
                  <span className="text-2xl font-bold text-text-primary font-mono">
                    —
                  </span>
                </div>
              ))}
            </div>
          )}
          {statsError && (
            <p className="px-4 pb-3 text-xs text-data-warn font-mono">
              Stats endpoint unavailable — showing placeholders
            </p>
          )}
        </Panel>

        {/* API Keys */}
        <Panel
          title="API Keys"
          liveStatus={keysError ? 'error' : keys ? 'live' : 'stale'}
        >
          {(keys && keys.length > 0) ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-bg-border text-left text-xs text-text-muted font-mono uppercase tracking-wider">
                  <th className="px-4 py-2 font-medium">ID</th>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className="border-b border-bg-border/50 hover:bg-bg-raised/50">
                    <td className="px-4 py-2 text-text-secondary font-mono text-xs">
                      {k.id}
                    </td>
                    <td className="px-4 py-2 text-text-primary font-mono">
                      {k.name}
                    </td>
                    <td className="px-4 py-2 text-text-muted font-mono text-xs">
                      {new Date(k.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="p-4 text-sm text-text-muted font-mono">
              {keysError ? 'Keys endpoint unavailable' : 'No API keys found'}
            </p>
          )}
        </Panel>

        {/* Integrations */}
        <Panel
          title="Integrations"
          subtitle="Secrets are validated live, stored encrypted, never shown back"
          liveStatus={integrationsError ? 'error' : integrations ? 'live' : 'stale'}
        >
          <div className="p-4 space-y-4">
            {(integrations && integrations.length > 0) ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-bg-border text-left text-xs text-text-muted font-mono uppercase tracking-wider">
                    <th className="px-4 py-2 font-medium">Integration</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Updated</th>
                    <th className="px-4 py-2 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {integrations.map((it) => (
                    <tr key={it.key} className="border-b border-bg-border/50 hover:bg-bg-raised/50">
                      <td className="px-4 py-2 text-text-primary font-mono">
                        {it.label}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {it.staged ? (
                          <span className="text-teal-vivid">● staged{it.healthy ? '' : ' (unverified)'}</span>
                        ) : (
                          <span className="text-data-warn">○ not staged</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-text-muted font-mono text-xs">
                        {it.updatedAt ? new Date(it.updatedAt).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-2">
                        {it.staged && (
                          <button
                            onClick={() => revokeToken(it.key)}
                            disabled={tokenBusy}
                            className="px-3 py-1 text-xs font-mono border border-data-bear/50 text-data-bear rounded hover:bg-data-bear/10 disabled:opacity-50"
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-text-muted font-mono">
                {integrationsError ? 'Integrations endpoint unavailable' : 'No integrations found'}
              </p>
            )}
            <div className="space-y-2 border-t border-bg-border/50 pt-4">
              <p className="text-xs text-text-muted font-mono">
                Stage Stockbit refresh token — validated live, then the rotated pair is saved encrypted.
                Validation spends one upstream rotation (documented behavior).
              </p>
              <textarea
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="Paste Stockbit refresh JWT (three segments)…"
                rows={3}
                spellCheck={false}
                className="w-full px-3 py-2 text-xs font-mono bg-bg-raised border border-bg-border rounded text-text-primary placeholder:text-text-muted/60"
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={stageToken}
                  disabled={tokenBusy}
                  className="px-4 py-2 bg-teal-vivid text-bg-base font-mono font-bold text-sm rounded hover:bg-teal-vivid/80 disabled:opacity-50"
                >
                  {tokenBusy ? 'Working…' : 'Stage token'}
                </button>
                {tokenMsg && (
                  <span className="text-xs font-mono text-text-secondary">{tokenMsg}</span>
                )}
              </div>
            </div>
          </div>
        </Panel>

        {/* Refunds — fulfills Terms §9: gateway-first refund, then local downgrade */}
        <Panel
          title="Refunds"
          subtitle="Terms §9 error-charge review: gateway refund first, local downgrade follows"
        >
          <div className="p-4 space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={refundId}
                onChange={(e) => setRefundId(e.target.value)}
                placeholder="Payment ID (from /account/payments order)"
                spellCheck={false}
                className="flex-1 px-3 py-2 text-xs font-mono bg-bg-raised border border-bg-border rounded text-text-primary placeholder:text-text-muted/60"
              />
              <input
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="Reason (e.g. duplicate charge)"
                spellCheck={false}
                className="flex-1 px-3 py-2 text-xs font-mono bg-bg-raised border border-bg-border rounded text-text-primary placeholder:text-text-muted/60"
              />
              <button
                disabled={refundBusy || !refundId.trim()}
                onClick={async () => {
                  setRefundBusy(true)
                  setRefundMsg(null)
                  try {
                    const res = await fetch('/api/v1/admin/refund', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ paymentId: refundId.trim(), reason: refundReason.trim() || undefined }),
                    })
                    const json = (await res.json()) as { data: { refunded?: boolean } | null; error: string | null }
                    if (res.ok && json.data?.refunded) {
                      setRefundId('')
                      setRefundReason('')
                      setRefundMsg('Refunded — gateway first, subscription downgraded to free.')
                    } else {
                      setRefundMsg(`Failed: ${json.error ?? `HTTP ${res.status}`}`)
                    }
                  } catch (e) {
                    setRefundMsg(`Failed: ${(e as Error).message}`)
                  } finally {
                    setRefundBusy(false)
                  }
                }}
                className="px-4 py-2 bg-data-bear/20 text-data-bear font-mono font-bold rounded hover:bg-data-bear/30 transition-colors disabled:opacity-50"
              >
                {refundBusy ? 'Refunding…' : 'Refund'}
              </button>
            </div>
            {refundMsg && (
              <p className="text-xs font-mono text-text-secondary">{refundMsg}</p>
            )}
          </div>
        </Panel>

        {/* Users */}
        <Panel
          title="Users"
          liveStatus={usersError ? 'error' : users ? 'live' : 'stale'}
        >
          {(users && users.length > 0) ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-bg-border text-left text-xs text-text-muted font-mono uppercase tracking-wider">
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">Plan</th>
                  <th className="px-4 py-2 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-bg-border/50 hover:bg-bg-raised/50">
                    <td className="px-4 py-2 text-text-primary font-mono">
                      {u.email}
                    </td>
                    <td className="px-4 py-2 text-text-secondary font-mono text-xs uppercase">
                      {u.plan}
                    </td>
                    <td className="px-4 py-2 text-text-muted font-mono text-xs">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="p-4 text-sm text-text-muted font-mono">
              {usersError ? 'Users endpoint unavailable' : 'No users found'}
            </p>
          )}
        </Panel>

        {/* Analytics */}
        {analytics && (
          <Panel
            title="Analytics"
            subtitle="Pageview traffic"
            liveStatus={analyticsError ? 'error' : 'live'}
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4">
              <div className="flex flex-col gap-1 p-4 bg-bg-raised rounded">
                <span className="text-xs text-text-muted font-mono uppercase tracking-wider">DAU</span>
                <span className="text-2xl font-bold text-text-primary font-mono">{analytics.dau}</span>
              </div>
              <div className="flex flex-col gap-1 p-4 bg-bg-raised rounded">
                <span className="text-xs text-text-muted font-mono uppercase tracking-wider">MAU</span>
                <span className="text-2xl font-bold text-text-primary font-mono">{analytics.mau}</span>
              </div>
              <div className="flex flex-col gap-1 p-4 bg-bg-raised rounded">
                <span className="text-xs text-text-muted font-mono uppercase tracking-wider">Total Views</span>
                <span className="text-2xl font-bold text-text-primary font-mono">{analytics.total}</span>
              </div>
            </div>
            {analytics.topPages && analytics.topPages.length > 0 && (
              <div className="px-4 pb-4">
                <p className="text-xs text-text-muted font-mono uppercase tracking-wider mb-2">Top Pages</p>
                <div className="space-y-1">
                  {analytics.topPages.slice(0, 5).map((p) => (
                    <div key={p.path} className="flex items-center justify-between text-xs font-mono">
                      <span className="text-text-secondary truncate">{p.path}</span>
                      <span className="text-text-muted ml-2">{p.count} views</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Panel>
        )}
      </div>
    </NexusLayout>
  )
}