// ─────────────────────────────────────────────────────────────
// Exchange Flow Detector — Detects whale deposits/withdrawals
// Uses entity labels to identify exchange-bound transactions
// ─────────────────────────────────────────────────────────────

import { getEntityLabel, type EntitySeed } from '../ai-signals/entity-labels-seed'

export interface FlowEvent {
  id: string
  from: string
  fromLabel: string
  to: string
  toLabel: string
  chain: string
  valueUsd: number
  timestamp: number
  type: 'deposit' | 'withdrawal' | 'transfer'
  isWhale: boolean
}

const flowLog: FlowEvent[] = []
const MAX_FLOWS = 1000

/** Check if an address is a known exchange */
export async function isExchangeAddress(address: string, chain: string = 'eth'): Promise<EntitySeed | undefined> {
  const entity = await getEntityLabel(address.toLowerCase(), chain)
  return entity?.category === 'cex' ? entity : undefined
}

/** Classify a transfer as deposit/withdrawal based on entity labels */
export async function classifyTransfer(from: string, to: string, chain: string): Promise<{
  type: 'deposit' | 'withdrawal' | 'transfer'
  fromLabel: string
  toLabel: string
}> {
  const [fromEntity, toEntity] = await Promise.all([
    isExchangeAddress(from, chain),
    isExchangeAddress(to, chain),
  ])

  if (!fromEntity && toEntity) return { type: 'deposit', fromLabel: 'Unknown', toLabel: toEntity.label }
  if (fromEntity && !toEntity) return { type: 'withdrawal', fromLabel: fromEntity.label, toLabel: 'Unknown' }
  if (fromEntity && toEntity) return { type: 'transfer', fromLabel: fromEntity.label, toLabel: toEntity.label }
  return { type: 'transfer', fromLabel: 'Unknown', toLabel: 'Unknown' }
}

/** Record a flow event */
export function recordFlow(event: FlowEvent) {
  flowLog.push(event)
  if (flowLog.length > MAX_FLOWS) flowLog.shift()
}

/** Get recent flow events */
export function getRecentFlows(limit = 50, type?: string): FlowEvent[] {
  let flows = flowLog.slice(-limit).reverse()
  if (type) flows = flows.filter(f => f.type === type)
  return flows
}

/** Get exchange netflow (deposits - withdrawals) for a time period */
export function getExchangeNetflow(periodMs = 86_400_000): {
  totalDeposits: number
  totalWithdrawals: number
  netflow: number
  signal: 'bullish' | 'bearish' | 'neutral'
} {
  const cutoff = Date.now() - periodMs
  const recent = flowLog.filter(f => f.timestamp >= cutoff)

  const deposits = recent.filter(f => f.type === 'deposit').reduce((sum, f) => sum + f.valueUsd, 0)
  const withdrawals = recent.filter(f => f.type === 'withdrawal').reduce((sum, f) => sum + f.valueUsd, 0)
  const netflow = deposits - withdrawals

  return {
    totalDeposits: deposits,
    totalWithdrawals: withdrawals,
    netflow,
    signal: netflow > 0 ? 'bearish' : netflow < 0 ? 'bullish' : 'neutral',
  }
}

/** Get whale flow summary */
export function getWhaleFlows(periodMs = 86_400_000): FlowEvent[] {
  const cutoff = Date.now() - periodMs
  return flowLog.filter(f => f.timestamp >= cutoff && f.isWhale).reverse()
}
