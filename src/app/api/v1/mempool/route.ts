// ─────────────────────────────────────────────────────────────
// GET /api/v1/mempool — Mempool Radar
// All actions wrapped in getCached with single-flight dedup
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { registerAllModules } from '@/lib/modules'
import { getCached } from '@/lib/api/server-cache'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') ?? 'stats'
  const registry = registerAllModules()

  try {
    switch (action) {
      case 'stats': {
        const { data, fromCache } = await getCached('mempool:stats', 10_000, async () => {
          const [fees, mempool] = await Promise.all([
            registry.fetchOne('mempool-space', { action: 'fees' }),
            registry.fetchOne('mempool-space', { action: 'mempool' }),
          ])
          const mempoolData = mempool.data as Record<string, unknown>
          const feeData = fees.data as Record<string, unknown>
          const txCount = (mempoolData?.count as number) ?? 0
          const totalFee = (mempoolData?.total_fee as number) ?? 0
          let congestion: { level: string; color: string; description: string }
          if (txCount < 5000) congestion = { level: 'low', color: 'green', description: 'Mempool is clear' }
          else if (txCount < 20000) congestion = { level: 'medium', color: 'yellow', description: 'Moderate congestion' }
          else if (txCount < 50000) congestion = { level: 'high', color: 'orange', description: 'High congestion' }
          else congestion = { level: 'extreme', color: 'red', description: 'Extreme congestion' }
          return { count: txCount, totalFee, fees: feeData, congestion, avgFee: txCount > 0 ? Math.round(totalFee / txCount) : 0, vsize: (mempoolData?.vsize as number) ?? 0 }
        })
        const resp = NextResponse.json({ data, error: null }, { headers: { 'Cache-Control': 'public, max-age=10, stale-while-revalidate=20' } })
        resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
        return resp
      }

      case 'whale': {
        const { data, fromCache } = await getCached('mempool:unconfirmed-whale:v2', 15_000, async () => {
          const WHALE_THRESHOLD_BTC = 10
          let btcPrice = 0
          try {
            const priceRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4400'}/api/v1/market/prices`, { signal: AbortSignal.timeout(10_000) })
            const priceData = await priceRes.json() as { data?: { tickers?: Array<Record<string, unknown>> } }
            const btcTicker = priceData.data?.tickers?.find(t => t.symbol === 'BTC')
            const rawPrice = btcTicker?.price
            btcPrice = typeof rawPrice === 'string' ? Number(rawPrice.replace(/[$,]/g, '')) : Number(rawPrice) || 0
          } catch { /* USD stays unknown when the price source fails */ }

          const response = await fetch('https://blockchain.info/unconfirmed-transactions?format=json', { signal: AbortSignal.timeout(10_000) })
          if (!response.ok) throw new Error(`Unconfirmed transaction source returned HTTP ${response.status}`)
          const payload = await response.json() as { txs?: Array<Record<string, unknown>> }
          if (!Array.isArray(payload.txs)) throw new Error('Unconfirmed transaction source shape invalid')
          const transactions = payload.txs.flatMap(tx => {
            const outputs = Array.isArray(tx.out) ? tx.out as Array<Record<string, unknown>> : []
            const valueBtc = outputs.reduce((sum, output) => sum + (Number(output.value) || 0), 0) / 1e8
            const txid = typeof tx.hash === 'string' ? tx.hash : ''
            if (!txid || valueBtc < WHALE_THRESHOLD_BTC) return []
            const rawVsize = Number(tx.weight) > 0 ? Math.ceil(Number(tx.weight) / 4) : null
            const rawFee = Number(tx.fee)
            const fee = Number.isFinite(rawFee) && rawFee >= 0 ? rawFee : null
            const seenAt = Number(tx.time)
            const age = Number.isFinite(seenAt) && seenAt > 0 ? Math.max(0, Math.floor(Date.now() / 1000 - seenAt)) : null
            return [{
              txid,
              valueBtc,
              valueUsd: btcPrice > 0 ? valueBtc * btcPrice : null,
              fee,
              vsize: rawVsize,
              rate: fee !== null && rawVsize ? fee / rawVsize : null,
              age,
            }]
          })
          transactions.sort((a, b) => b.valueBtc - a.valueBtc)
          return {
            transactions: transactions.slice(0, 20),
            count: transactions.length,
            threshold: `${WHALE_THRESHOLD_BTC} BTC`,
            source: 'blockchain.info',
          }
        })

        const resp = NextResponse.json({ data, error: null }, { headers: { 'Cache-Control': 'public, max-age=15' } })
        resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
        return resp
      }

      case 'blocks': {
        const { data, fromCache } = await getCached('mempool:blocks', 15_000, async () => {
          const blocks = await registry.fetchOne('mempool-space', { action: 'blocks' })
          return blocks.data
        })
        const resp = NextResponse.json({ data, error: null }, { headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' } })
        resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
        return resp
      }

      case 'hashrate': {
        const { data, fromCache } = await getCached('mempool:hashrate', 300_000, async () => {
          const hashrate = await registry.fetchOne('mempool-space', { action: 'hashrate' })
          return hashrate.data
        })
        const resp = NextResponse.json({ data, error: null }, { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' } })
        resp.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS')
        return resp
      }

      default:
        return NextResponse.json({ data: null, error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (err) {
    console.error('[mempool] Error:', err)
    return NextResponse.json({ data: null, error: (err as Error).message }, { status: 502 })
  }
}
