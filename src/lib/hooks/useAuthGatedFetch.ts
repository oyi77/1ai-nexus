"use client"

import { useState, useEffect, useCallback, useRef } from 'react'

type FetchStatus = 'live' | 'stale' | 'error' | 'auth-required'

interface UseAuthGatedFetchOptions<T> {
  url: string
  interval?: number
  transform?: (data: unknown) => T
  initialData?: T
}

interface UseAuthGatedFetchResult<T> {
  data: T
  status: FetchStatus
  isAuthenticated: boolean
  refresh: () => Promise<void>
}

/**
 * Like useLiveFetch but detects 401 responses and reports
 * 'auth-required' status instead of silently showing empty data.
 * Pages use this to render a "Sign in to unlock" state.
 */
export function useAuthGatedFetch<T>({
  url,
  interval = 30_000,
  transform,
  initialData,
}: UseAuthGatedFetchOptions<T>): UseAuthGatedFetchResult<T> {
  const [data, setData] = useState<T>(initialData as T)
  const [status, setStatus] = useState<FetchStatus>('live')
  const [isAuthenticated, setIsAuthenticated] = useState(true)
  const mountedRef = useRef(true)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(url)
      if (res.status === 401) {
        if (mountedRef.current) {
          setStatus('auth-required')
          setIsAuthenticated(false)
        }
        return
      }
      const json = await res.json()
      const payload = unwrapEnvelope(json)
      if (mountedRef.current) {
        setData((transform ? transform(payload) : payload) as T)
        setStatus('live')
        setIsAuthenticated(true)
      }
    } catch {
      if (mountedRef.current) setStatus('error')
    }
  }, [url, transform])

  useEffect(() => {
    mountedRef.current = true
    fetchData()
    const id = setInterval(fetchData, interval)
    return () => { mountedRef.current = false; clearInterval(id) }
  }, [fetchData, interval])

  return { data, status, isAuthenticated, refresh: fetchData }
}

function unwrapEnvelope(json: unknown): unknown {
  if (
    json !== null &&
    typeof json === 'object' &&
    !Array.isArray(json) &&
    'data' in json
  ) {
    return (json as { data: unknown }).data
  }
  return json
}

