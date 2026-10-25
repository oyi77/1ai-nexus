import { prisma } from '@/lib/db'

// Public Beacon Node API; netStaked stays null unless a source reports total balance.

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
    asset: 'ETH', entryQueue: null, exitQueue: null, netStaked: null,
    entryWaitDays: null, exitWaitDays: null, timestamp: new Date().toISOString(),
  }
  const beacon = 'https://ethereum-beacon-api.publicnode.com/eth/v1/beacon'
  const [entering, exiting] = await Promise.all([
    fetch(`${beacon}/states/head/validators?status=pending_queued`, { signal: AbortSignal.timeout(15_000) }),
    fetch(`${beacon}/states/head/validators?status=active_exiting`, { signal: AbortSignal.timeout(15_000) }),
  ])
  if (!entering.ok || !exiting.ok) throw new Error('Beacon validator queue unavailable')
  const enteringData = await entering.json() as { data?: Array<{ validator?: { activation_epoch?: string } }> }
  const exitingData = await exiting.json() as { data?: Array<{ validator?: { exit_epoch?: string } }> }
  if (!Array.isArray(enteringData.data) || !Array.isArray(exitingData.data)) throw new Error('Beacon validator queue shape invalid')
  result.entryQueue = enteringData.data.length
  result.exitQueue = exitingData.data.length
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
