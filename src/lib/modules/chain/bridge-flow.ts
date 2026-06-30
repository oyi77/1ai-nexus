// ─────────────────────────────────────────────────────────────
// Bridge Flow Tracker Module
// Tracks large cross-chain transfers via public bridge APIs
// Zero API keys — uses public bridge data
// ─────────────────────────────────────────────────────────────

interface BridgeFlowEvent {
  sourceChain: string
  destChain: string
  asset: string
  amountUsd: number
  timestamp: string
}

// ─── Wormhole / Bridge Flows via DeFiLlama ─────────────────

export async function fetchBridgeFlows(): Promise<BridgeFlowEvent[]> {
  try {
    // DeFiLlama bridges endpoint — public, free
    const res = await fetch('https://bridges.llama.fi/bridgevolume/1d', { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return []
    const data = await res.json() as Array<{ date: string; totalVolume24h?: number; chains?: Record<string, { volume24h?: number }> }>

    const events: BridgeFlowEvent[] = []

    for (const entry of data.slice(-7)) { // Last 7 days
      if (!entry.chains) continue
      const chainEntries = Object.entries(entry.chains)
      for (const [chain, info] of chainEntries) {
        if (!info.volume24h || info.volume24h < 1_000_000) continue
        events.push({
          sourceChain: chain,
          destChain: 'Multi-chain',
          asset: 'Aggregate',
          amountUsd: info.volume24h,
          timestamp: entry.date,
        })
      }
    }

    return events.sort((a, b) => b.amountUsd - a.amountUsd).slice(0, 20)
  } catch { return [] }
}

// ─── Aggregate Bridge Stats ────────────────────────────────

export async function fetchBridgeStats() {
  try {
    const res = await fetch('https://bridges.llama.fi/bridges?includeChains=true', { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return { bridges: [], totalVolume24h: 0 }
    const data = await res.json() as { bridges?: Array<{ name: string; volumePreviousDay?: number; chains?: string[] }> }

    const bridges = (data.bridges ?? [])
      .filter(b => (b.volumePreviousDay ?? 0) > 0)
      .sort((a, b) => (b.volumePreviousDay ?? 0) - (a.volumePreviousDay ?? 0))
      .slice(0, 15)
      .map(b => ({
        name: b.name,
        volume24h: b.volumePreviousDay ?? 0,
        chains: b.chains ?? [],
      }))

    const totalVolume24h = bridges.reduce((s, b) => s + b.volume24h, 0)

    return { bridges, totalVolume24h }
  } catch { return { bridges: [], totalVolume24h: 0 } }
}
