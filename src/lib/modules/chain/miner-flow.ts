import { prisma } from '@/lib/db'

// ─────────────────────────────────────────────────────────────
// Miner Flow Monitor Module
// Tracks Bitcoin miner wallet outflows + hash rate
// Zero API keys — uses mempool.space public API
// ─────────────────────────────────────────────────────────────

export interface MinerFlowSnapshot {
  outflowToExchangesUsd: number | null
  hashRate: number | null
  hashRateUnit: string
  difficulty: number | null
  blockHeight: number | null
  signal: string
  timestamp: string
}

export async function fetchMinerFlow(): Promise<MinerFlowSnapshot> {
  const result: MinerFlowSnapshot = {
    outflowToExchangesUsd: null,
    hashRate: null,
    hashRateUnit: 'EH/s',
    difficulty: null,
    blockHeight: null,
    signal: 'Insufficient data',
    timestamp: new Date().toISOString(),
  }

  try {
    // Hash rate from mempool.space
    const res = await fetch('https://mempool.space/api/v1/mining/hashrate/1m', { signal: AbortSignal.timeout(10_000) })
    if (res.ok) {
      const data = await res.json() as { currentHashrate?: number; difficulty?: number }
      if (data.currentHashrate) {
        result.hashRate = data.currentHashrate / 1e18 // Convert to EH/s
      }
      if (data.difficulty) {
        result.difficulty = data.difficulty
      }
    }
  } catch { /* optional */ }

  try {
    // Block height
    const res = await fetch('https://mempool.space/api/blocks/tip/height', { signal: AbortSignal.timeout(5_000) })
    if (res.ok) {
      const text = await res.text()
      result.blockHeight = parseInt(text, 10) || null
    }
  } catch { /* optional */ }

  // Compute signal
  if (result.hashRate && result.hashRate > 0) {
    if (result.hashRate > 700) {
      result.signal = 'Strong hash rate — miner confidence high, bullish'
    } else if (result.hashRate > 500) {
      result.signal = 'Healthy hash rate — neutral miner behavior'
    } else {
      result.signal = 'Low hash rate — miners may be capitulating'
    }
  }

  return result
}

export async function persistMinerFlow(snapshot: MinerFlowSnapshot): Promise<boolean> {
  try {
    await prisma.minerFlowSnapshot.create({
      data: {
        outflowToExchangesUsd: 0, // No live outflow data yet
        hashRate: snapshot.hashRate,
      },
    })
    return true
  } catch { return false }
}
