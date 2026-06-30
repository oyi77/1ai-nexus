// ─────────────────────────────────────────────────────────────
// Mempool Intelligence Module
// Pending transaction monitoring from public sources
// Zero API keys — uses public mempool data APIs
// ─────────────────────────────────────────────────────────────

interface MempoolEvent {
  chain: string
  type: 'large_swap' | 'large_transfer' | 'sandwich_attack' | 'liquidation'
  asset: string
  estUsd: number | null
  detectedAt: string
  confirmedAt: string | null
  metadata: Record<string, unknown>
}

// ─── Bitcoin Mempool ───────────────────────────────────────

async function fetchBitcoinMempool(): Promise<MempoolEvent[]> {
  try {
    const res = await fetch('https://mempool.space/api/mempool', { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return []
    const data = await res.json() as { count?: number; vsize?: number; total_fee?: number }

    const events: MempoolEvent[] = []
    if (data.count && data.count > 50000) {
      events.push({
        chain: 'bitcoin',
        type: 'large_transfer',
        asset: 'BTC',
        estUsd: null,
        detectedAt: new Date().toISOString(),
        confirmedAt: null,
        metadata: {
          mempoolSize: data.count,
          vsize: data.vsize,
          totalFee: data.total_fee,
          signal: 'High mempool congestion — potential volatility',
        },
      })
    }
    return events
  } catch { return [] }
}

// ─── Ethereum Mempool (via public endpoint) ────────────────

async function fetchEthereumMempool(): Promise<MempoolEvent[]> {
  try {
    const res = await fetch('https://api.etherscan.io/api?module=gastracker&action=gasoracle', {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return []
    const data = await res.json() as { result?: { SafeGasPrice?: string; ProposeGasPrice?: string; FastGasPrice?: string } }
    const gas = data.result
    if (!gas) return []

    const events: MempoolEvent[] = []
    const fastGas = parseFloat(gas.FastGasPrice ?? '0')

    // High gas = congestion = potential large pending txs
    if (fastGas > 50) {
      events.push({
        chain: 'ethereum',
        type: 'large_transfer',
        asset: 'ETH',
        estUsd: null,
        detectedAt: new Date().toISOString(),
        confirmedAt: null,
        metadata: {
          safeGas: gas.SafeGasPrice,
          proposeGas: gas.ProposeGasPrice,
          fastGas: gas.FastGasPrice,
          signal: `High gas (${fastGas} gwei) — large pending activity`,
        },
      })
    }
    return events
  } catch { return [] }
}

// ─── Aggregate ─────────────────────────────────────────────

export async function fetchMempoolEvents(): Promise<MempoolEvent[]> {
  const [btc, eth] = await Promise.allSettled([
    fetchBitcoinMempool(),
    fetchEthereumMempool(),
  ])

  return [
    ...(btc.status === 'fulfilled' ? btc.value : []),
    ...(eth.status === 'fulfilled' ? eth.value : []),
  ].sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime())
}
