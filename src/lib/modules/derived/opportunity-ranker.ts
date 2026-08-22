// ─────────────────────────────────────────────────────────────
// Opportunity Ranker (P5)
// Unifies the divergent signal shapes from alpha-engine, arbitrage,
// launch-alpha, LRFG, and SFC into one normalized Opportunity, ranks
// by composite score, persists to OpportunitySnapshot, closes the
// loop on forward outcome, and alerts the top-N.
//
// Canonical Opportunity (imports the rich alpha AlphaSignal type as
// the reference shape for direction/strength semantics).
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { getAlphaSignals } from '@/lib/modules/derived/alpha-engine'
import { scanArbitrage } from '@/lib/modules/market/arbitrage-engine'
import { fetchLaunchAlpha, type LaunchAlphaToken } from '@/lib/modules/derived/launch-alpha-engine'
import { fetchLrfgEvents, type LrfgEventDTO } from '@/lib/modules/derived/lrfg-engine'
import { computeSfcConvergence } from '@/lib/modules/derived/sfc-engine'

export type OppSource = 'alpha' | 'arb' | 'launch' | 'lrfg' | 'sfc'
export type OppDirection = 'bullish' | 'bearish' | 'neutral'

export interface Opportunity {
  id: string
  asset: string
  source: OppSource
  direction: OppDirection
  score: number // 0-100 composite
  confidence: number // 0-100
  reason: string
  createdAt: string
  metadata: Record<string, unknown>
}

function norm(v: number, lo: number, hi: number): number {
  if (hi === lo) return 0
  return Math.max(0, Math.min(1, (v - lo) / (hi - lo)))
}

export async function gatherOpportunities(): Promise<Opportunity[]> {
  const out: Opportunity[] = []

  // 1. Alpha signals (rich shape)
  try {
    const res = await getAlphaSignals()
    for (const s of res.signals) {
      if (s.direction === 'neutral') continue
      const score = Math.round((norm(s.strength, 0, 100) * 0.7 + norm(s.confidence, 0, 100) * 0.3) * 100)
      out.push({
        id: `alpha:${s.id}`,
        asset: s.symbol,
        source: 'alpha',
        direction: s.direction,
        score,
        confidence: Math.round(norm(s.confidence, 0, 100) * 100),
        reason: s.reasoning,
        createdAt: new Date(s.timestamp).toISOString(),
        metadata: { sources: s.sources, entry: s.entry, sl: s.sl, tp1: s.tp1 },
      })
    }
  } catch { /* skip */ }

  // 2. Arbitrage price spreads
  try {
    const snap = await scanArbitrage({ minSpreadBps: 3, minFundingBps: 50, minBasisPercent: 0.5 })
    for (const sp of snap.priceSpreads ?? []) {
      const bps = sp.spreadPercent * 100 // spreadPercent is in % units (0.12 = 12 bps)
      if (Math.abs(bps) < 3) continue
      const score = Math.min(100, Math.round(Math.abs(bps) / 2))
      out.push({
        id: `arb:${sp.symbol}`,
        asset: sp.symbol,
        source: 'arb',
        direction: bps > 0 ? 'bearish' : 'bullish',
        score,
        confidence: 80,
        reason: `Cross-exchange spread ${bps.toFixed(1)} bps`,
        createdAt: new Date().toISOString(),
        metadata: { buyExchange: sp.buyExchange, buyPrice: sp.buyPrice, sellExchange: sp.sellExchange, sellPrice: sp.sellPrice },
      })
    }
  } catch { /* skip */ }

  // 3. Launch Alpha tokens
  try {
    const tokens: LaunchAlphaToken[] = await fetchLaunchAlpha({ limit: 30 })
    for (const t of tokens) {
      out.push({
        id: `launch:${t.address}`,
        asset: t.symbol,
        source: 'launch',
        direction: 'bullish',
        score: t.launchAlphaScore,
        confidence: Math.min(100, t.hypeScore + 20),
        reason: `Launch Alpha ${t.launchAlphaScore} (liq $${Math.round(t.liquidityUsd).toLocaleString()})`,
        createdAt: new Date().toISOString(),
        metadata: { address: t.address, chain: t.chain, liquidityUsd: t.liquidityUsd },
      })
    }
  } catch { /* skip */ }

  // 4. LRFG events (rebound candidates)
  try {
    const events: LrfgEventDTO[] = await fetchLrfgEvents({ limit: 30 })
    for (const e of events) {
      if (e.reboundedAt) continue
      const score = Math.min(100, Math.round(e.severity * 100))
      out.push({
        id: `lrfg:${e.id}`,
        asset: e.symbol,
        source: 'lrfg',
        direction: 'bullish',
        score,
        confidence: 70,
        reason: `Leverage reset: OI Δ${e.oiDeltaPct.toFixed(1)}% | price Δ${e.priceDeltaPct.toFixed(1)}%`,
        createdAt: e.detectedAt,
        metadata: { exchange: e.exchange, oiDeltaPct: e.oiDeltaPct, priceDeltaPct: e.priceDeltaPct },
      })
    }
  } catch { /* skip */ }

  // 5. SFC convergence for the hottest launch tokens
  try {
    const tokens: LaunchAlphaToken[] = await fetchLaunchAlpha({ limit: 10 })
    for (const t of tokens) {
      const conv = await computeSfcConvergence(t.symbol)
      if (conv.walletCount === 0 || conv.sfc < 50) continue
      out.push({
        id: `sfc:${t.symbol}`,
        asset: t.symbol,
        source: 'sfc',
        direction: 'bullish',
        score: Math.min(100, conv.sfc),
        confidence: 65,
        reason: `SFC convergence ${conv.sfc} across ${conv.walletCount} smart wallets`,
        createdAt: new Date().toISOString(),
        metadata: { sfc: conv.sfc, walletCount: conv.walletCount, repricingGapPct: conv.repricingGapPct },
      })
    }
  } catch { /* skip */ }

  return out.sort((a, b) => b.score - a.score)
}

// Persist top opportunities + close the loop on prior unresolved ones.
export async function rankAndPersist(limit = 25, alertTopN = 5): Promise<Opportunity[]> {
  await closeOpportunityLoop()
  const all = await gatherOpportunities()
  const top = all.slice(0, limit)

  for (const o of top) {
    const price = await latestCexPrice(o.asset)
    try {
      await prisma.opportunitySnapshot.create({
        data: {
          asset: o.asset,
          source: o.source,
          direction: o.direction,
          score: o.score,
          confidence: o.confidence,
          reason: o.reason,
          metadata: o.metadata as unknown as Prisma.InputJsonValue,
          priceAtCreate: price,
        },
      })
    } catch { /* skip */ }
  }

  const alerts = top.slice(0, alertTopN)
  for (const o of alerts) {
    if (o.score < 60) continue
    try {
      await prisma.alert.create({
        data: {
          userId: 'system',
          triggerType: 'opportunity_rank',
          name: `Opportunity: ${o.asset} (${o.source})`,
          conditions: {
            asset: o.asset,
            source: o.source,
            score: o.score,
          },
        },
      })
    } catch { /* skip */ }
  }

  return top
}

async function latestCexPrice(asset: string): Promise<number | null> {
  const sym = asset.replace(/USDT?$/, '')
  const row = await prisma.marketSnapshot.findFirst({
    where: { symbol: sym, sourceId: 'cex:coingecko' },
    orderBy: { timestamp: 'desc' },
  })
  return row?.price ?? null
}

// Resolve opportunities older than RESOLVE_MIN with the realized move.
export async function closeOpportunityLoop(resolveMin = 60): Promise<number> {
  const cutoff = new Date(Date.now() - resolveMin * 60_000)
  const open = await prisma.opportunitySnapshot.findMany({
    where: { resolved: false, createdAt: { lte: cutoff } },
    take: 200,
  })
  let resolved = 0
  for (const o of open) {
    if (o.priceAtCreate == null) continue
    // Only alpha/arb/lrfg have a forward price reference; others skipped.
    if (!['alpha', 'arb', 'lrfg'].includes(o.source)) {
      await prisma.opportunitySnapshot.update({ where: { id: o.id }, data: { resolved: true, resolvedAt: new Date() } })
      resolved++
      continue
    }
    const sym = o.asset.replace(/USDT?$/, '')
    const row = await prisma.marketSnapshot.findFirst({ where: { symbol: sym, sourceId: 'cex:coingecko' }, orderBy: { timestamp: 'desc' } })
    if (!row || row.price === 0) continue
    const realized = ((row.price - o.priceAtCreate) / o.priceAtCreate) * 100
    const dirMult = o.direction === 'bearish' ? -1 : 1
    await prisma.opportunitySnapshot.update({
      where: { id: o.id },
      data: { resolved: true, resolvedAt: new Date(), realizedPct: Math.round(realized * dirMult * 100) / 100 },
    })
    resolved++
  }
  return resolved
}

export async function fetchOpportunities(limit = 50): Promise<Opportunity[]> {
  const rows = await prisma.opportunitySnapshot.findMany({
    where: { resolved: false },
    orderBy: { score: 'desc' },
    take: limit,
  })
  return rows.map((r) => ({
    id: r.id,
    asset: r.asset,
    source: r.source as OppSource,
    direction: r.direction as OppDirection,
    score: r.score,
    confidence: r.confidence,
    reason: r.reason,
    createdAt: r.createdAt.toISOString(),
    metadata: (r.metadata as Record<string, unknown>) ?? {},
  }))
}
