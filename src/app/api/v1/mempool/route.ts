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
        const { data, fromCache } = await getCached('mempool:whale', 15_000, async () => {
          const WHALE_THRESHOLD_BTC = 2
          const txs: Array<Record<string, unknown>> = []
          let btcPrice = 0

          // BTC price
          try {
            const priceRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4400'}/api/v1/market/prices`, { signal: AbortSignal.timeout(10_000) })
            const priceData = await priceRes.json() as { data?: { tickers?: Array<Record<string, unknown>> } }
            const btcTicker = priceData.data?.tickers?.find((t: Record<string, unknown>) => t.symbol === 'BTC')
            if (btcTicker) btcPrice = typeof btcTicker.price === 'string' ? parseFloat(btcTicker.price.replace(/[$,]/g, '')) : (btcTicker.price as number) || 0
          } catch { /* use 0 */ }

          // blockchain.info unconfirmed
          try {
            const bcRes = await fetch('https://blockchain.info/unconfirmed-transactions?format=json', { signal: AbortSignal.timeout(10_000) })
            const bcData = await bcRes.json() as { txs: Array<Record<string, unknown>> }
            for (const tx of (bcData.txs || [])) {
              const totalOut = ((tx.out as Array<Record<string, unknown>>) || []).reduce((s: number, o: Record<string, unknown>) => s + ((o.value as number) || 0), 0) / 1e8
              if (totalOut >= WHALE_THRESHOLD_BTC) {
                txs.push({ txid: tx.hash, valueBtc: totalOut, valueUsd: totalOut * btcPrice, block: 'mempool', fee: (tx.fee as number) || 0, size: (tx.size as number) || 0 })
              }
            }
          } catch { /* silent */ }

          // mempool.space recent blocks
          try {
            const tipRes = await fetch('https://mempool.space/api/blocks/tip/height', { signal: AbortSignal.timeout(10_000) })
            const tipHeight = parseInt(await tipRes.text(), 10)
            for (let i = 0; i < 3 && tipHeight - i > 0; i++) {
              const height = tipHeight - i
              const hashRes = await fetch(`https://mempool.space/api/block-height/${height}`, { signal: AbortSignal.timeout(10_000) })
              const blockHash = (await hashRes.text()).trim()
              for (const startIndex of [0, 25]) {
                const txRes = await fetch(`https://mempool.space/api/block/${blockHash}/txs/${startIndex}`, { signal: AbortSignal.timeout(15_000) })
                if (!txRes.ok) continue
                const blockTxs = await txRes.json() as Array<Record<string, unknown>>
                for (const tx of blockTxs) {
                  const totalOut = ((tx.vout as Array<Record<string, unknown>>) || []).reduce((s: number, o: Record<string, unknown>) => s + ((o.value as number) || 0), 0) / 1e8
                  if (totalOut >= WHALE_THRESHOLD_BTC && !txs.some(existing => existing.txid === tx.txid)) {
                    txs.push({ txid: tx.txid, valueBtc: totalOut, valueUsd: totalOut * btcPrice, block: height, fee: (tx.fee as number) || 0, size: (tx.size as number) || 0 })
                  }
                }
              }
            }
          } catch { /* silent */ }

          txs.sort((a, b) => (b.valueBtc as number) - (a.valueBtc as number))
          return { transactions: txs.slice(0, 20), count: txs.length, threshold: `${WHALE_THRESHOLD_BTC} BTC (~$${btcPrice > 0 ? (WHALE_THRESHOLD_BTC * btcPrice / 1000).toFixed(0) : '?'}K)`, source: 'mempool.space + blockchain.info' }
        })

        const resp = NextResponse.json({ data, error: null }, { headers: { 'Cache-Control': 'public, max-age=60' } })
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
    const fallbackData = action === 'stats'
      ? {
          count: 0,
          totalFee: 0,
          fees: { fastestFee: 1, halfHourFee: 1, hourFee: 1, minimumFee: 1 },
          congestion: { level: 'low', color: 'green', description: 'Mempool data temporarily unavailable' },
          avgFee: 0,
          vsize: 0,
        }
      : action === 'whale'
      ? { transactions: [], count: 0, threshold: '2 BTC', source: 'offline-fallback' }
      : action === 'blocks'
      ? []
      : action === 'hashrate'
      ? { currentHashrate: 0 }
      : null
    return NextResponse.json({ data: fallbackData, error: null, notice: (err as Error).message }, { status: 200 })
  }
}
