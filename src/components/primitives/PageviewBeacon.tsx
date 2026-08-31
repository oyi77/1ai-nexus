'use client'

import { useEffect } from 'react'

/**
 * Pageview beacon — fires a single POST to /api/v1/analytics/pageview
 * per session (tracked via sessionStorage). Renders nothing.
 */
export function PageviewBeacon() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (sessionStorage.getItem('nexus-pv-beacon')) return

    const body = JSON.stringify({
      path: window.location.pathname,
      referrer: document.referrer || undefined,
    })

    fetch('/api/v1/analytics/pageview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      // Fire-and-forget; swallow errors
    })

    sessionStorage.setItem('nexus-pv-beacon', '1')
  }, [])

  return null
}