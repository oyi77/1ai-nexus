"use client"

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'

interface FollowItem {
  type: 'entity' | 'wallet'
  id: string
  label: string
  createdAt: string
}

interface FeedItem {
  id: string
  wallet: {
    address: string
    chain: string
    entityId: string | null
    entity: { name: string; type: string } | null
  }
  type: string
  amountUsd: number
  tokenSymbol: string | null
  timestamp: string
  txHash: string
}

export default function FollowingPage() {
  const [follows, setFollows] = useState<FollowItem[]>([])
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [auth, setAuth] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading')
  const [status, setStatus] = useState<'live' | 'stale' | 'error'>('stale')

  const fetchAll = useCallback(async () => {
    try {
      const [followsRes, feedRes] = await Promise.all([
        fetch('/api/v1/follows'),
        fetch('/api/v1/follows/feed?limit=20'),
      ])

      if (followsRes.status === 401) {
        setAuth('unauthenticated')
        return
      }

      if (followsRes.ok) {
        const fd = await followsRes.json()
        setFollows(fd?.data?.follows ?? [])
      }
      if (feedRes.ok) {
        const fd = await feedRes.json()
        setFeed(fd?.data?.items ?? [])
      }
      setAuth('authenticated')
      setStatus('live')
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAll()
  }, [fetchAll])

  const handleUnfollow = useCallback(async (item: FollowItem) => {
    try {
      const res = await fetch(`/api/v1/follows?type=${item.type}&id=${encodeURIComponent(item.id)}`, { method: 'DELETE' })
      if (res.ok) {
        setFollows(prev => prev.filter(f => !(f.type === item.type && f.id === item.id)))
        setFeed([])
        setStatus('stale')
        fetchAll()
      }
    } catch { /* no-op */ }
  }, [fetchAll])

  if (auth === 'unauthenticated') {
    return (
      <NexusLayout>
        <div className="p-4 max-w-3xl mx-auto">
          <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <h1 className="text-[24px] font-head font-bold text-text-primary">Following</h1>
            <p className="text-[14px] font-mono text-text-secondary">Sign in to follow traders</p>
            <Link
              href="/login"
              className="px-4 py-2 bg-teal-vivid text-bg-base font-mono font-bold text-sm rounded hover:bg-teal-vivid/80 transition-colors"
            >
              Sign In
            </Link>
          </div>
        </div>
      </NexusLayout>
    )
  }

  return (
    <NexusLayout>
      <div className="p-4 space-y-4 max-w-5xl mx-auto">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[24px] font-head font-bold text-text-primary">Following</h1>
            <p className="text-[12px] font-mono text-text-muted mt-1">
              {follows.length} {follows.length === 1 ? 'trader' : 'traders'} tracked
            </p>
          </div>
          <LiveDot status={status} label />
        </div>

        {/* Followed list */}
        <Panel title="Followed" subtitle={`${follows.length} items`}>
          {follows.length > 0 ? (
            <div className="space-y-1 p-2">
              {follows.map((item) => (
                <div key={`${item.type}-${item.id}`} className="flex items-center justify-between p-2 hover:bg-bg-raised rounded transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-raised text-text-muted uppercase shrink-0">
                      {item.type}
                    </span>
                    {item.type === 'entity' ? (
                      <Link href={`/entity/${encodeURIComponent(item.id)}`} className="text-[13px] font-mono text-text-primary truncate hover:text-teal-vivid transition-colors">
                        {item.label}
                      </Link>
                    ) : (
                      <Link href={`/wallet/${encodeURIComponent(item.id)}`} className="text-[13px] font-mono text-text-primary truncate hover:text-teal-vivid transition-colors">
                        {item.label}
                      </Link>
                    )}
                  </div>
                  <button
                    onClick={() => handleUnfollow(item)}
                    className="text-[11px] font-mono font-bold px-2 py-1 rounded border border-bg-border text-text-muted hover:text-data-bear hover:border-data-bear transition-colors shrink-0"
                  >
                    Unfollow
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[12px] font-mono text-text-muted p-8 text-center">
              {auth === 'loading' ? 'Loading...' : 'No follows yet. Browse entities and wallets to follow traders.'}
            </div>
          )}
        </Panel>

        {/* Activity Feed */}
        <Panel title="Activity Feed" subtitle={`${feed.length} recent transactions`}>
          {feed.length > 0 ? (
            <div className="space-y-1 p-2">
              {feed.map((item) => {
                const label = item.wallet?.entity?.name ?? (item.wallet?.address ? item.wallet.address.slice(0, 10) + '…' : 'Unknown')
                const href = item.wallet?.entityId
                  ? `/entity/${encodeURIComponent(item.wallet.entityId)}`
                  : `/wallet/${encodeURIComponent(item.wallet.address)}`
                return (
                  <div key={item.id} className="flex items-center justify-between p-2 hover:bg-bg-raised rounded transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <Link href={href} className="text-[13px] font-mono text-text-primary truncate hover:text-teal-vivid transition-colors">
                        {label}
                      </Link>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-raised text-text-muted uppercase shrink-0">
                        {item.type}
                      </span>
                      <span className="text-[13px] font-mono text-text-primary tabular-nums">
                        ${item.amountUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                      {item.tokenSymbol && (
                        <span className="text-[11px] font-mono text-text-muted">{item.tokenSymbol}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {item.wallet && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-raised text-text-muted uppercase">{item.wallet.chain}</span>
                      )}
                      <span className="text-[11px] font-mono text-text-muted">
                        {new Date(item.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-[12px] font-mono text-text-muted p-8 text-center">
              {status === 'live' ? 'No recent activity from followed traders.' : 'Loading feed...'}
            </div>
          )}
        </Panel>
      </div>
    </NexusLayout>
  )
}