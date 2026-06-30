import { prisma } from '@/lib/db'

// ─────────────────────────────────────────────────────────────
// Staking Queue Monitor Module
// Tracks ETH staking entry/exit queue from beaconcha.in
// Zero API keys — public beaconcha.in API
// ─────────────────────────────────────────────────────────────

export interface StakingSnapshot {
  asset: string
  entryQueue: number | null
  exitQueue: number | null
  netStaked: number | null
  entryWaitDays: number | null
  exitWaitDays: number | null
  timestamp: string
}

export async function fetchStakingQueue(): Promise<StakingSnapshot> {
  const result: StakingSnapshot = {
    asset: 'ETH',
    entryQueue: null,
    exitQueue: null,
    netStaked: null,
    entryWaitDays: null,
    exitWaitDays: null,
    timestamp: new Date().toISOString(),
  }

  try {
    // beaconcha.in public API for ETH staking queue
    const res = await fetch('https://beaconcha.in/api/v1/validators/queue', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return result

    const data = await res.json() as { data?: { beaconchain_entering?: number; beaconchain_exiting?: number } }
    const queue = data.data
    if (!queue) return result

    result.entryQueue = queue.beaconchain_entering ?? null
    result.exitQueue = queue.beaconchain_exiting ?? null

    // Estimate wait times (rough: ~1000 validators per epoch = ~6.4 min per 32 ETH)
    if (result.entryQueue && result.entryQueue > 0) {
      result.entryWaitDays = Math.ceil(result.entryQueue * 32 * 6.4 / (60 * 24 * 1000))
    }
    if (result.exitQueue && result.exitQueue > 0) {
      result.exitWaitDays = Math.ceil(result.exitQueue * 32 * 6.4 / (60 * 24 * 1000))
    }
  } catch {
    // beaconcha.in may be unavailable
  }

  // Fetch total staked ETH from beaconcha.in
  try {
    const res = await fetch('https://beaconcha.in/api/v1/epoch/latest', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) {
      const data = await res.json() as { data?: { totalvalidatorbalance?: number } }
      if (data.data?.totalvalidatorbalance) {
        result.netStaked = data.data.totalvalidatorbalance / 1e9 // Convert Gwei to ETH
      }
    }
  } catch { /* optional */ }

  return result
}

export async function persistStakingFlow(snapshot: StakingSnapshot): Promise<boolean> {
  try {
    await prisma.stakingFlowSnapshot.create({
      data: {
        asset: snapshot.asset,
        entryQueue: snapshot.entryQueue,
        exitQueue: snapshot.exitQueue,
        netStaked: snapshot.netStaked,
      },
    })
    return true
  } catch { return false }
}
