interface GasPrice {
  chain: string
  slow: number
  standard: number
  fast: number
  unit: string
  congestion: 'low' | 'medium' | 'high' | 'extreme'
}

const EVM_RPC: Record<string, string> = {
  Ethereum: 'https://ethereum-rpc.publicnode.com',
  Arbitrum: 'https://arb1.arbitrum.io/rpc',
  Base: 'https://mainnet.base.org',
  Optimism: 'https://mainnet.optimism.io',
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  return fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }).then((payload) => {
    const body = payload as { result?: T; error?: { message?: string } }
    if (body.result === undefined) throw new Error(body.error?.message ?? `${method} unavailable`)
    return body.result
  })
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)]
}

async function getEvmGas(chain: string, url: string): Promise<GasPrice> {
  const history = await rpc<{
    baseFeePerGas?: string[]
    reward?: string[][]
    gasUsedRatio?: number[]
  }>(url, 'eth_feeHistory', [4, 'latest', [25, 50, 75]])
  const baseFees = history.baseFeePerGas ?? []
  const baseFee = baseFees.length > 0 ? parseInt(baseFees[baseFees.length - 1], 16) / 1e9 : NaN
  if (!Number.isFinite(baseFee)) throw new Error(`${chain} fee history has no base fee`)
  const rewards = history.reward ?? []
  const priorities = [0, 1, 2].map(tier => median(rewards.map(block => parseInt(block[tier] ?? '0', 16) / 1e9).filter(Number.isFinite)))
  const utilization = median(history.gasUsedRatio ?? [])
  return {
    chain,
    slow: baseFee + priorities[0],
    standard: baseFee + priorities[1],
    fast: baseFee + priorities[2],
    unit: 'gwei',
    congestion: utilization > 0.95 ? 'extreme' : utilization > 0.8 ? 'high' : utilization > 0.5 ? 'medium' : 'low',
  }
}

async function getSolanaGas(): Promise<GasPrice> {
  const fees = await rpc<Array<{ prioritizationFee?: number }>>('https://api.mainnet-beta.solana.com', 'getRecentPrioritizationFees', [])
  const positiveFees = fees.map(item => item.prioritizationFee ?? 0).filter(fee => fee > 0)
  const priority = median(positiveFees)
  return {
    chain: 'Solana',
    slow: 0,
    standard: priority,
    fast: positiveFees.length > 0 ? Math.max(...positiveFees) : priority,
    unit: 'lamports/CU',
    congestion: positiveFees.length > fees.length * 0.8 ? 'high' : positiveFees.length > fees.length * 0.4 ? 'medium' : 'low',
  }
}

export async function getGasPrices(): Promise<GasPrice[]> {
  const requests: Array<Promise<GasPrice>> = Object.entries(EVM_RPC).map(([chain, url]) => getEvmGas(chain, url))
  requests.push(getSolanaGas())
  requests.push(fetchJson('https://mempool.space/api/v1/fees/recommended').then((payload) => {
    const fees = payload as Record<string, number>
    const fast = fees.fastestFee || fees.halfHourFee
    if (!Number.isFinite(fast)) throw new Error('Bitcoin fee estimate unavailable')
    return {
      chain: 'Bitcoin',
      slow: fees.minimumFee || fees.economyFee,
      standard: fees.hourFee || fees.halfHourFee,
      fast,
      unit: 'sat/vB',
      congestion: fast > 100 ? 'extreme' : fast > 50 ? 'high' : fast > 20 ? 'medium' : 'low',
    }
  }))
  const results = await Promise.allSettled(requests)
  return results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
}

export async function getGasTrend(): Promise<{ chain: string; trend: 'rising' | 'falling' | 'stable' }[]> {
  return []
}
