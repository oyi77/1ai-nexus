// ─────────────────────────────────────────────────────────────
// Module: Blockscout ETH
// sourceType: oss-mirror
// Endpoint: blockscout.com (Etherscan-compatible REST API)
// Replaces: Etherscan API key
// Coverage: Tx history, token holdings, contract verification, address labels
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const CHAINS: Record<string, string> = {
  eth:   'https://eth.blockscout.com/api',
  arb:   'https://arbitrum.blockscout.com/api',
  base:  'https://base.blockscout.com/api',
  op:    'https://optimism.blockscout.com/api',
  polygon: 'https://polygon.blockscout.com/api',
  bsc:   'https://bsc.blockscout.com/api',
}

async function blockscoutFetch<T>(chain: string, params: Record<string, string>): Promise<T> {
  const base = CHAINS[chain] ?? CHAINS.eth
  const qs = new URLSearchParams(params)
  const res = await fetch(`${base}?${qs}`)
  if (!res.ok) throw new Error(`Blockscout ${res.status}: ${chain}`)
  const json = await res.json() as { status: string; result: T; message: string }
  if (json.status === '0' && json.message !== 'No transactions found') {
    throw new Error(`Blockscout error: ${json.message}`)
  }
  return json.result
}

async function fetchBlockscout(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'txlist'
  const address = params.address as string
  const chain = (params.chain as string) ?? 'eth'

  if (!address) throw new Error('Blockscout: address required')

  switch (action) {
    case 'txlist':
      return blockscoutFetch(chain, {
        module: 'account', action: 'txlist', address,
        startblock: '0', endblock: '99999999', page: '1', offset: String(params.limit ?? 50), sort: 'desc',
      })
    case 'tokentx':
      return blockscoutFetch(chain, {
        module: 'account', action: 'tokentx', address,
        page: '1', offset: String(params.limit ?? 50), sort: 'desc',
      })
    case 'balance':
      return blockscoutFetch(chain, {
        module: 'account', action: 'balance', address, tag: 'latest',
      })
    case 'tokenbalance': {
      const contract = params.contract as string
      return blockscoutFetch(chain, {
        module: 'account', action: 'tokenbalance', address, contractaddress: contract, tag: 'latest',
      })
    }
    case 'abi':
      return blockscoutFetch(chain, {
        module: 'contract', action: 'getabi', address,
      })
    default:
      throw new Error(`Blockscout: unknown action ${action}`)
  }
}

const blockscoutModule: DataModule = {
  id: 'blockscout-eth',
  name: 'Blockscout (ETH)',
  category: 'onchain',
  sourceType: 'oss-mirror',
  provenance: {
    describesItself: "Blockscout's Etherscan-compatible REST API for ETH/ARB/BASE/OP/BSC/Polygon",
    upstreamProduct: 'Etherscan',
    discoveredVia: 'docs',
    fragility: 'stable',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      await blockscoutFetch('eth', { module: 'account', action: 'balance', address: '0x0000000000000000000000000000000000000000', tag: 'latest' })
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'blockscout-eth',
      params,
      TTL.ENTITY_LABEL,
      () => fetchBlockscout(params) as Promise<T>,
    )
  },
}

export default blockscoutModule
