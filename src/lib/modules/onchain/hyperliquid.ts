// ─────────────────────────────────────────────────────────────
// Module: Hyperliquid
// sourceType: public-api
// Endpoint: api.hyperliquid.xyz/info
// Coverage: Perps OI, funding, liquidations, leaderboard, vault data
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASE = 'https://api.hyperliquid.xyz/info'

async function hlPost<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Hyperliquid ${res.status}`)
  return res.json() as Promise<T>
}

async function fetchHyperliquid(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'meta'

  switch (action) {
    case 'meta':
      return hlPost<unknown>({ type: 'meta' })
    case 'allMids':
      return hlPost<unknown>({ type: 'allMids' })
    case 'clearinghouse': {
      const user = params.user as string
      return hlPost<unknown>({ type: 'clearinghouseState', user })
    }
    case 'openOrders': {
      const user = params.user as string
      return hlPost<unknown>({ type: 'openOrders', user })
    }
    case 'funding': {
      const coin = (params.coin as string) ?? 'BTC'
      const startTime = (params.startTime as number) ?? Date.now() - 86400000
      return hlPost<unknown>({ type: 'fundingHistory', coin, startTime })
    }
    case 'liquidations':
      return hlPost<unknown>({ type: 'userNonFundingLedgerUpdates', user: '' })
    case 'leaderboard':
      return hlPost<unknown>({ type: 'leaderboard', sortBy: 'pnl' })
    case 'vaults':
      return hlPost<unknown>({ type: 'vaults' })
    default:
      throw new Error(`Hyperliquid: unknown action ${action}`)
  }
}

const hyperliquidModule: DataModule = {
  id: 'hyperliquid',
  name: 'Hyperliquid',
  category: 'derivatives',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'Hyperliquid DEX — perpetual futures OI, funding rates, liquidations, leaderboard, vaults',
    fragility: 'stable',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      await hlPost<unknown>({ type: 'meta' })
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'hyperliquid',
      params,
      TTL.DERIVATIVES,
      () => fetchHyperliquid(params) as Promise<T>,
    )
  },
}

export default hyperliquidModule
