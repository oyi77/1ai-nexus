"use client"

import { useState, useEffect, useCallback, useRef } from 'react'

type FetchStatus = 'live' | 'stale' | 'error'

interface UseLiveFetchOptions<T> {
  url: string
  interval?: number
  transform?: (data: unknown) => T
  initialData?: T
}

interface UseLiveFetchResult<T> {
  data: T
  status: FetchStatus
  refresh: () => Promise<void>
}

/**
 * Detect and unwrap the standard API envelope { data: <payload>, error: ... }.
 * Returns the inner payload when the envelope is present, otherwise passes through.
 */
function unwrapEnvelope(json: unknown): unknown {
  if (
    json !== null &&
    typeof json === 'object' &&
    !Array.isArray(json) &&
    'data' in json &&
    'error' in json
  ) {
    return (json as { data: unknown }).data
  }
  return json
}

export function useLiveFetch<T>({
  url,
  interval = 30_000,
  transform,
  initialData,
}: UseLiveFetchOptions<T>): UseLiveFetchResult<T> {
  const [data, setData] = useState<T>(initialData as T)
  const [status, setStatus] = useState<FetchStatus>('live')
  const mountedRef = useRef(true)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(url)
      const json = await res.json()
      const payload = unwrapEnvelope(json)
      if (mountedRef.current) {
        setData((transform ? transform(payload) : payload) as T)
        setStatus('live')
      }
    } catch {
      if (mountedRef.current) setStatus('error')
    }
  }, [url, transform])

  useEffect(() => {
    mountedRef.current = true
    const invoke = () => fetchData()
    invoke()
    const id = setInterval(fetchData, interval)
    return () => { mountedRef.current = false; clearInterval(id) }
  }, [fetchData, interval])

  return { data, status, refresh: fetchData }
}
