// ─────────────────────────────────────────────────────────────
// Data Abstraction Layer (DAL) Registry
// Tier 0/1/2 auto-selection with health tracking
// §0.3 — extend existing module pattern, don't replace
// ─────────────────────────────────────────────────────────────

import { z } from 'zod'

export type DataTier = 0 | 1 | 2
export type SourceStatus = 'active' | 'degraded' | 'down' | 'unavailable'

export interface DalSource {
  id: string
  name: string
  domain: string
  tier: DataTier
  requiresKey?: string
  requiresIDResidency?: boolean
  rateLimit?: { maxRequests: number; windowMs: number }
  cacheTtlMs: number
  healthCheck: () => Promise<boolean>
  fetch: (params: Record<string, unknown>) => Promise<unknown>
  responseSchema?: z.ZodType
}

interface SourceState {
  source: DalSource
  status: SourceStatus
  lastSuccess?: Date
  lastFailure?: Date
  failureCount: number
  lastLatencyMs: number
}

class DalRegistry {
  private sources = new Map<string, SourceState>()
  private domainGroups = new Map<string, DalSource[]>()

  register(source: DalSource): void {
    // Check if tier requires a key that's not configured
    if (source.requiresKey && !process.env[source.requiresKey]) {
      this.sources.set(source.id, {
        source,
        status: 'unavailable',
        failureCount: 0,
        lastLatencyMs: 0,
      })
      return
    }

    this.sources.set(source.id, {
      source,
      status: 'active',
      failureCount: 0,
      lastLatencyMs: 0,
    })

    // Group by domain for tier fallback
    const group = this.domainGroups.get(source.domain) || []
    group.push(source)
    group.sort((a, b) => a.tier - b.tier) // Prefer lower tier (free first)
    this.domainGroups.set(source.domain, group)
  }

  registerAll(sources: DalSource[]): void {
    for (const s of sources) this.register(s)
  }

  /**
   * Fetch from the best available tier for a domain.
   * Falls back through tiers on failure.
   */
  async fetchBest(domain: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const group = this.domainGroups.get(domain)
    if (!group || group.length === 0) {
      throw new Error(`No DAL sources registered for domain: ${domain}`)
    }

    let lastError: Error | null = null
    for (const source of group) {
      const state = this.sources.get(source.id)
      if (!state || state.status === 'unavailable') continue

      // Skip degraded sources unless it's the last option
      if (state.status === 'down' && group.indexOf(source) < group.length - 1) continue

      const start = Date.now()
      try {
        // Schema validation if defined
        const result = await source.fetch(params)
        if (source.responseSchema) {
          source.responseSchema.parse(result)
        }

        state.status = 'active'
        state.lastSuccess = new Date()
        state.failureCount = 0
        state.lastLatencyMs = Date.now() - start
        return result
      } catch (err) {
        lastError = err as Error
        state.failureCount++
        state.lastFailure = new Date()
        state.lastLatencyMs = Date.now() - start
        state.status = state.failureCount >= 3 ? 'down' : 'degraded'
      }
    }

    throw lastError || new Error(`All tiers failed for domain: ${domain}`)
  }

  getHealth(): Array<{ id: string; domain: string; tier: DataTier; status: SourceStatus; lastSuccess?: Date; failureCount: number; latencyMs: number }> {
    return Array.from(this.sources.values()).map(s => ({
      id: s.source.id,
      domain: s.source.domain,
      tier: s.source.tier,
      status: s.status,
      lastSuccess: s.lastSuccess,
      failureCount: s.failureCount,
      latencyMs: s.lastLatencyMs,
    }))
  }

  getByDomain(domain: string): DalSource[] {
    return this.domainGroups.get(domain) || []
  }

  getStatus(id: string): SourceState | undefined {
    return this.sources.get(id)
  }
}

// Singleton
let registry: DalRegistry | null = null

export function getDalRegistry(): DalRegistry {
  if (!registry) {
    registry = new DalRegistry()
  }
  return registry
}

export { DalRegistry }
