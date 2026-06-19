// ─────────────────────────────────────────────────────────────
// Module: Snapshot (Governance)
// sourceType: public-api
// Endpoint: hub.snapshot.org/graphql
// Coverage: DAO governance proposals, votes, results — no key
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASE = 'https://hub.snapshot.org/graphql'

async function snapshotQuery<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Snapshot ${res.status}`)
  const json = await res.json() as { data: T }
  return json.data
}

async function fetchSnapshot(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'proposals'

  switch (action) {
    case 'proposals': {
      const query = `{
        proposals(first: 20, orderBy: "created", orderDirection: desc, where: { state: "active" }) {
          id title state created end space { id name }
        }
      }`
      return snapshotQuery<unknown>(query)
    }
    case 'space': {
      const id = (params.id as string) ?? 'ens.eth'
      const query = `{
        space(id: "${id}") { id name about network followers }
      }`
      return snapshotQuery<unknown>(query)
    }
    default:
      throw new Error(`Snapshot: unknown action ${action}`)
  }
}

const snapshotModule: DataModule = {
  id: 'snapshot',
  name: 'Snapshot Governance',
  category: 'news',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'Snapshot — DAO governance proposals, votes, and results across all DAOs',
    fragility: 'stable',
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },
  isEnabled: () => true,
  async healthCheck(): Promise<ModuleHealth> {
    try {
      await snapshotQuery('{ proposals(first: 1) { id } }')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },
  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('snapshot', params, TTL.NEWS, () => fetchSnapshot(params) as Promise<T>)
  },
}

export default snapshotModule
