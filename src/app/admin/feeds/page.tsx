"use client"

// ─────────────────────────────────────────────────────────────
// Admin > Feeds — manage the RSS registry stored in Postgres.
// Add / edit / enable-disable / delete feeds, with last-check
// status and 7d/30d uptime per feed. Mutations invalidate the
// loader cache server-side, so the news engine picks them up
// within seconds.
// ─────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'

const CATEGORIES = [
  'crypto', 'macro', 'regulatory', 'tradfi', 'tech', 'political',
  'social', 'science', 'energy', 'geopolitical', 'indonesia',
] as const

interface LastCheck {
  ok: boolean
  status: number
  error: string | null
  ms: number
  checkedAt: string
}

interface AdminFeed {
  id: string
  feedId: string
  url: string
  category: string
  enabled: boolean
  uptime7d: number | null
  uptime30d: number | null
  lastCheck: LastCheck | null
}

interface FeedsData {
  feeds: AdminFeed[]
  total: number
  enabled: number
}

function uptimeColor(pct: number | null): string {
  if (pct === null) return 'text-text-muted'
  if (pct >= 95) return 'text-data-ok'
  if (pct >= 70) return 'text-data-warn'
  return 'text-data-bad'
}

export default function AdminFeedsPage() {
  const [data, setData] = useState<FeedsData | null>(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')

  // form state
  const [newFeedId, setNewFeedId] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newCategory, setNewCategory] = useState<string>('crypto')

  const fetchFeeds = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/admin/feeds')
      if (!res.ok) { setError(true); return }
      const json = (await res.json()) as { data: FeedsData }
      setData(json.data)
      setError(false)
    } catch {
      setError(true)
    }
  }, [])

  useEffect(() => {
    fetchFeeds()
  }, [fetchFeeds])

  const mutate = useCallback(async (method: string, body?: unknown, qs = '') => {
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch(`/api/v1/admin/feeds${qs}`, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
      const json = (await res.json()) as { data: unknown; error: string | null }
      if (!res.ok) {
        setNotice(`✗ ${json.error ?? `HTTP ${res.status}`}`)
      } else {
        setNotice('✓ saved')
        await fetchFeeds()
      }
    } catch (e) {
      setNotice(`✗ ${String(e).slice(0, 80)}`)
    } finally {
      setBusy(false)
      setTimeout(() => setNotice(null), 4000)
    }
  }, [fetchFeeds])

  const addFeed = useCallback(() => {
    if (!newFeedId.trim() || !newUrl.trim()) { setNotice('✗ feedId and url are required'); return }
    void mutate('POST', { feedId: newFeedId.trim(), url: newUrl.trim(), category: newCategory })
    setNewFeedId('')
    setNewUrl('')
  }, [newFeedId, newUrl, newCategory, mutate])

  const filtered = useMemo(() => {
    if (!data) return []
    return filter === 'all'
      ? data.feeds
      : data.feeds.filter((f) => f.category === filter)
  }, [data, filter])

  const stats = useMemo(() => {
    if (!data) return null
    const checked = data.feeds.filter((f) => f.lastCheck)
    const ok = checked.filter((f) => f.lastCheck!.ok).length
    return { total: data.total, enabled: data.enabled, checked: checked.length, okLast: ok }
  }, [data])

  return (
    <NexusLayout>
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Heading */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-text-primary">Feeds Registry</h1>
          <div className="flex items-center gap-3 text-xs text-text-muted font-mono">
            {notice && <span className={notice.startsWith('✓') ? 'text-data-ok' : 'text-data-bad'}>{notice}</span>}
            <LiveDot status={error ? 'error' : data ? 'live' : 'stale'} size={5} />
            <button
              onClick={() => void fetchFeeds()}
              className="px-2 py-1 rounded border border-bg-border hover:bg-bg-raised text-text-secondary"
            >
              refresh
            </button>
          </div>
        </div>

        {/* Summary */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Total', value: stats.total },
              { label: 'Enabled', value: stats.enabled },
              { label: 'Checked', value: stats.checked },
              { label: 'OK (last check)', value: `${stats.okLast}/${stats.checked}` },
            ].map((s) => (
              <div key={s.label} className="flex flex-col gap-1 p-4 bg-bg-raised rounded">
                <span className="text-xs text-text-muted font-mono uppercase tracking-wider">{s.label}</span>
                <span className="text-2xl font-bold text-text-primary font-mono">{s.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Add form */}
        <Panel title="Add Feed" liveStatus={busy ? 'stale' : 'live'}>
          <div className="p-4 grid grid-cols-1 md:grid-cols-[180px_1fr_160px_auto] gap-3 items-end">
            <label className="flex flex-col gap-1 text-xs text-text-muted font-mono uppercase tracking-wider">
              Feed ID
              <input
                value={newFeedId}
                onChange={(e) => setNewFeedId(e.target.value)}
                placeholder="coindesk"
                className="mt-1 px-3 py-2 bg-bg-raised border border-bg-border rounded text-sm text-text-primary font-mono normal-case"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-muted font-mono uppercase tracking-wider">
              RSS URL
              <input
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://example.com/feed"
                className="mt-1 px-3 py-2 bg-bg-raised border border-bg-border rounded text-sm text-text-primary font-mono normal-case"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-muted font-mono uppercase tracking-wider">
              Category
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="mt-1 px-3 py-2 bg-bg-raised border border-bg-border rounded text-sm text-text-primary font-mono normal-case"
              >
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <button
              onClick={addFeed}
              disabled={busy}
              className="px-4 py-2 rounded bg-accent-primary/20 border border-accent-primary/40 text-accent-primary text-sm font-mono hover:bg-accent-primary/30 disabled:opacity-50"
            >
              {busy ? '…' : 'add'}
            </button>
          </div>
        </Panel>

        {/* Table */}
        <Panel
          title="Registry"
          subtitle={`${filtered.length} shown`}
          liveStatus={error ? 'error' : data ? 'live' : 'stale'}
        >
          <div className="px-4 pt-3 flex gap-1 flex-wrap">
            <button
              onClick={() => setFilter('all')}
              className={`px-2 py-1 rounded text-xs font-mono border ${filter === 'all' ? 'border-accent-primary/50 text-accent-primary' : 'border-bg-border text-text-muted'}`}
            >
              all
            </button>
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setFilter(c)}
                className={`px-2 py-1 rounded text-xs font-mono border ${filter === c ? 'border-accent-primary/50 text-accent-primary' : 'border-bg-border text-text-muted hover:text-text-secondary'}`}
              >
                {c}
              </button>
            ))}
          </div>
          {error ? (
            <p className="p-4 text-sm text-data-bad font-mono">Feeds endpoint unavailable</p>
          ) : !data ? (
            <p className="p-4 text-sm text-text-muted font-mono">Loading…</p>
          ) : (
            <div className="p-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-bg-border text-left text-xs text-text-muted font-mono uppercase tracking-wider">
                    <th className="px-2 py-2 font-medium">ID</th>
                    <th className="px-2 py-2 font-medium">Category</th>
                    <th className="px-2 py-2 font-medium">URL</th>
                    <th className="px-2 py-2 font-medium">Last</th>
                    <th className="px-2 py-2 font-medium">7d</th>
                    <th className="px-2 py-2 font-medium">30d</th>
                    <th className="px-2 py-2 font-medium">On</th>
                    <th className="px-2 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((f) => (
                    <tr key={f.id} className="border-b border-bg-border/50 hover:bg-bg-raised/50">
                      <td className="px-2 py-2 text-text-primary font-mono text-xs">{f.feedId}</td>
                      <td className="px-2 py-2 text-text-secondary font-mono text-xs">{f.category}</td>
                      <td className="px-2 py-2 max-w-xs">
                        <a
                          href={f.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block truncate text-text-secondary hover:text-text-primary font-mono text-xs"
                          title={f.url}
                        >
                          {f.url}
                        </a>
                        {f.lastCheck && !f.lastCheck.ok && f.lastCheck.error && (
                          <span className="block truncate text-data-bad text-[10px] font-mono" title={f.lastCheck.error}>
                            {f.lastCheck.error}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 font-mono text-xs">
                        {f.lastCheck ? (
                          <span className={f.lastCheck.ok ? 'text-data-ok' : 'text-data-bad'}>
                            {f.lastCheck.ok ? `${f.lastCheck.status}·${f.lastCheck.ms}ms` : 'dead'}
                          </span>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </td>
                      <td className={`px-2 py-2 font-mono text-xs ${uptimeColor(f.uptime7d)}`}>
                        {f.uptime7d === null ? '—' : `${f.uptime7d}%`}
                      </td>
                      <td className={`px-2 py-2 font-mono text-xs ${uptimeColor(f.uptime30d)}`}>
                        {f.uptime30d === null ? '—' : `${f.uptime30d}%`}
                      </td>
                      <td className="px-2 py-2">
                        <button
                          onClick={() => void mutate('PATCH', { id: f.id, enabled: !f.enabled })}
                          disabled={busy}
                          className={`px-2 py-0.5 rounded text-xs font-mono border disabled:opacity-50 ${
                            f.enabled
                              ? 'border-data-ok/40 text-data-ok'
                              : 'border-bg-border text-text-muted'
                          }`}
                        >
                          {f.enabled ? 'on' : 'off'}
                        </button>
                      </td>
                      <td className="px-2 py-2">
                        <button
                          onClick={() => {
                            if (window.confirm(`Delete feed "${f.feedId}"? Health history goes with it.`)) {
                              void mutate('DELETE', undefined, `?id=${encodeURIComponent(f.id)}`)
                            }
                          }}
                          disabled={busy}
                          className="px-2 py-0.5 rounded text-xs font-mono border border-data-bad/40 text-data-bad hover:bg-data-bad/10 disabled:opacity-50"
                        >
                          del
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </NexusLayout>
  )
}
