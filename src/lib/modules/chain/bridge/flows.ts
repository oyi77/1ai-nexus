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
  const res = await fetch('https://bridges.llama.fi/bridgevolume/1d', { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`Bridge flow source HTTP ${res.status}`)
  const data = await res.json() as Array<{ date: string; totalVolume24h?: number; chains?: Record<string, { volume24h?: number }> }>
  if (!Array.isArray(data)) throw new Error('Bridge flow source shape invalid')
  const events: BridgeFlowEvent[] = []
  for (const entry of data.slice(-7)) {
    if (!entry.chains) continue
    for (const [chain, info] of Object.entries(entry.chains)) {
      if (!info.volume24h || info.volume24h < 1_000_000) continue
      events.push({ sourceChain: chain, destChain: 'Multi-chain', asset: 'Aggregate', amountUsd: info.volume24h, timestamp: entry.date })
    }
  }
  return events.sort((a, b) => b.amountUsd - a.amountUsd).slice(0, 20)
}

// ─── Aggregate Bridge Stats ────────────────────────────────

export async function fetchBridgeStats() {
  const res = await fetch('https://bridges.llama.fi/bridges?includeChains=true', { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`Bridge source HTTP ${res.status}`)
  const data = await res.json() as { bridges?: Array<{ name: string; volumePreviousDay?: number; chains?: string[] }> }
  if (!Array.isArray(data.bridges)) throw new Error('Bridge source returned no bridge list')
  const bridges = data.bridges
    .filter(b => (b.volumePreviousDay ?? 0) > 0)
    .sort((a, b) => (b.volumePreviousDay ?? 0) - (a.volumePreviousDay ?? 0))
    .slice(0, 15)
    .map(b => ({ name: b.name, volume24h: b.volumePreviousDay ?? 0, chains: b.chains ?? [] }))
  return { bridges, totalVolume24h: bridges.reduce((sum, b) => sum + b.volume24h, 0) }
}

import { prisma } from '@/lib/db'

export async function persistBridgeFlows(events: BridgeFlowEvent[]): Promise<number> {
  let count = 0
  for (const e of events) {
    try {
      await prisma.bridgeFlowEvent.create({
        data: {
          sourceChain: e.sourceChain,
          destChain: e.destChain,
          asset: e.asset,
          amountUsd: e.amountUsd,
          timestamp: new Date(e.timestamp),
        },
      })
      count++
    } catch { /* skip */ }
  }
  return count
}
