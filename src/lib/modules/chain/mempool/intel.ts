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

export async function fetchMempoolEvents(): Promise<MempoolEvent[]> {
  const res = await fetch('https://blockchain.info/unconfirmed-transactions?format=json', { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`Unconfirmed transaction source returned HTTP ${res.status}`)
  const data = await res.json() as { txs?: Array<{ hash?: unknown; out?: unknown; time?: unknown }> }
  if (!Array.isArray(data.txs)) throw new Error('Unconfirmed transaction source shape invalid')
  return data.txs.flatMap(tx => {
    if (typeof tx.hash !== 'string') return []
    const outputs = Array.isArray(tx.out) ? tx.out as Array<{ value?: unknown }> : []
    const valueBtc = outputs.reduce((sum, output) => sum + (Number(output.value) || 0), 0) / 1e8
    if (valueBtc < 10) return []
    const seenAt = Number(tx.time)
    return [{
      chain: 'BTC',
      type: 'large_transfer' as const,
      asset: 'BTC',
      estUsd: null,
      detectedAt: new Date(Number.isFinite(seenAt) && seenAt > 0 ? seenAt * 1000 : Date.now()).toISOString(),
      confirmedAt: null,
      metadata: { txid: tx.hash, valueBtc, signal: `${valueBtc.toFixed(2)} BTC unconfirmed transfer` },
    }]
  }).sort((a, b) => Number(b.metadata.valueBtc) - Number(a.metadata.valueBtc)).slice(0, 20)
}
import { prisma } from '@/lib/db'

export async function persistMempoolEvents(events: MempoolEvent[]): Promise<number> {
  let count = 0
  for (const e of events) {
    try {
      await prisma.mempoolEvent.create({
        data: {
          chain: e.chain,
          type: e.type,
          asset: e.asset,
          estUsd: e.estUsd,
          detectedAt: new Date(e.detectedAt),
          confirmedAt: e.confirmedAt ? new Date(e.confirmedAt) : null,
          metadata: e.metadata ? JSON.parse(JSON.stringify(e.metadata)) : undefined,
        },
      })
      count++
    } catch { /* skip duplicates */ }
  }
  return count
}
