// ─────────────────────────────────────────────────────────────
// Module: Covalent (GoldRush)
// sourceType: public-api
// Endpoint: api.covalenthq.com
// Coverage: Multi-chain token balances, transactions, NFTs — free tier
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASE = 'https://api.covalenthq.com/v1'

async function covalentFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Accept: 'application/json',
      Authorization: 'Bearer cqt_demoKey', // Demo key for free tier
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Covalent ${res.status}: ${path}`)
  const json = await res.json() as { data: T }
  return json.data
}

async function fetchCovalent(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'balances'
  const chainId = (params.chainId as string) ?? '1' // ETH mainnet
  const address = params.address as string

  switch (action) {
    case 'balances': {
      if (!address) throw new Error('Covalent: address required')
      return covalentFetch<unknown>(`/${chainId}/address/${address}/balances_v2/`)
    }
    case 'transactions': {
      if (!address) throw new Error('Covalent: address required')
      return covalentFetch<unknown>((`/${chainId}/address/${address}/transactions_v2/`))
    }
    case 'nfts': {
      if (!address) throw new Error('Covalent: address required')
      return covalentFetch<unknown>(`/${chainId}/address/${address}/balances_nft/`)
    }
    default:
      throw new Error(`Covalent: unknown action ${action}`)
  }
}

const covalentModule: DataModule = {
  id: 'covalent',
  name: 'Covalent (GoldRush)',
  category: 'onchain',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'Covalent GoldRush — multi-chain token balances, transactions, NFT data across 200+ chains',
    fragility: 'stable',
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },
  isEnabled: () => true,
  async healthCheck(): Promise<ModuleHealth> {
    try {
      await covalentFetch('/1/address/0x0000000000000000000000000000000000000000/balances_v2/')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },
  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('covalent', params, TTL.ENTITY_LABEL, () => fetchCovalent(params) as Promise<T>)
  },
}

export default covalentModule
