// ─────────────────────────────────────────────────────────────
// Fetch Utilities — Shared patterns for external API calls
// - fetchWithFallback: Try primary, fallback to secondary
// - fetchWithAggregation: Fetch from multiple sources, merge
// - fetchGraceful: Fetch with graceful degradation (never 502)
// ─────────────────────────────────────────────────────────────

interface FetchResult<T> {
  data: T | null
  source: string
  success: boolean
  latencyMs: number
  error?: string
}

interface AggregatedResult<T> {
  data: T[]
  sources: Array<{ name: string; success: boolean; count: number; latencyMs: number; error?: string }>
  totalUnique: number
}

/**
 * Fetch with fallback — try primary, fallback to secondary
 * Never throws, returns null on complete failure
 */
export async function fetchWithFallback<T>(
  primary: { name: string; fetch: () => Promise<T> },
  fallback: { name: string; fetch: () => Promise<T> },
): Promise<FetchResult<T>> {
  // Try primary
  const start1 = Date.now()
  try {
    const data = await primary.fetch()
    return { data, source: primary.name, success: true, latencyMs: Date.now() - start1 }
  } catch (e) {
    // Try fallback
    const start2 = Date.now()
    try {
      const data = await fallback.fetch()
      return { data, source: fallback.name, success: true, latencyMs: Date.now() - start2 }
    } catch (e2) {
      return { data: null, source: 'none', success: false, latencyMs: Date.now() - start1, error: (e2 as Error).message }
    }
  }
}

/**
 * Fetch with aggregation — fetch from all sources, merge results
 * Each source is independent (error-isolated)
 */
export async function fetchWithAggregation<T>(
  sources: Array<{ name: string; fetch: () => Promise<T[]> }>,
  deduplicateBy?: (item: T) => string,
): Promise<AggregatedResult<T>> {
  const results = await Promise.all(
    sources.map(async (source) => {
      const start = Date.now()
      try {
        const data = await source.fetch()
        return { source: source.name, data, success: true, latencyMs: Date.now() - start }
      } catch (e) {
        return { source: source.name, data: [] as T[], success: false, latencyMs: Date.now() - start, error: (e as Error).message }
      }
    })
  )

  const sourceInfo = results.map(r => ({
    name: r.source,
    success: r.success,
    count: r.data.length,
    latencyMs: r.latencyMs,
    error: r.error,
  }))

  // Combine all data
  const allData: T[] = []
  for (const r of results) {
    allData.push(...r.data)
  }

  // Deduplicate if function provided
  let deduped = allData
  if (deduplicateBy) {
    const seen = new Map<string, T>()
    for (const item of allData) {
      const key = deduplicateBy(item)
      if (!seen.has(key)) {
        seen.set(key, item)
      }
    }
    deduped = Array.from(seen.values())
  }

  return {
    data: deduped,
    sources: sourceInfo,
    totalUnique: deduped.length,
  }
}

/**
 * Fetch with graceful degradation — never returns 502
 * Returns empty data instead of error on failure
 */
export async function fetchGraceful<T>(
  fetcher: () => Promise<T>,
  defaultValue: T,
): Promise<{ data: T; success: boolean; error?: string }> {
  try {
    const data = await fetcher()
    return { data, success: true }
  } catch (e) {
    return { data: defaultValue, success: false, error: (e as Error).message }
  }
}
