"use client"

import { useCallback, useEffect, useState } from 'react'

interface FollowButtonProps {
  type: 'entity' | 'wallet'
  id: string
  className?: string
}

export function FollowButton({ type, id, className = '' }: FollowButtonProps) {
  const [following, setFollowing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    fetch('/api/v1/follows')
      .then(async r => {
        if (r.status === 401) return null
        if (!r.ok) return null
        const d = await r.json()
        return d?.data?.follows ?? []
      })
      .then(follows => {
        if (cancelled) return
        setFollowing(Array.isArray(follows) && follows.some(f => f.type === type && String(f.id) === String(id)))
        setLoading(false)
      })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [type, id])

  const toggle = useCallback(async () => {
    if (busy || !id) return
    setBusy(true)
    try {
      if (following) {
        const res = await fetch(`/api/v1/follows?type=${type}&id=${encodeURIComponent(id)}`, { method: 'DELETE' })
        if (res.status === 401) return
        if (res.ok) setFollowing(false)
      } else {
        const res = await fetch('/api/v1/follows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, id }),
        })
        if (res.status === 401) return
        if (res.ok) setFollowing(true)
      }
    } finally {
      setBusy(false)
    }
  }, [busy, following, type, id])

  if (loading) {
    return (
      <button
        disabled
        className={`px-3 py-1.5 text-xs font-mono font-bold rounded border border-bg-border text-text-muted ${className}`}
      >
        …
      </button>
    )
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`px-3 py-1.5 text-xs font-mono font-bold rounded border transition-colors ${
        following
          ? 'bg-teal-vivid text-bg-base border-teal-vivid hover:bg-teal-vivid/80'
          : 'border-teal-vivid text-teal-vivid hover:bg-teal-vivid/10'
      } ${busy ? 'opacity-60' : ''} ${className}`}
    >
      {following ? 'Following' : 'Follow'}
    </button>
  )
}