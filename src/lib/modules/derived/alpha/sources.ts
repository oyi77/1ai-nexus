// ─────────────────────────────────────────────────────────────
// Alpha Signal Engine — Signal Source Implementations
// Each source function collects raw signals for the alpha engine
// ─────────────────────────────────────────────────────────────

import type { PartialSignal } from './types'
import { getFlowData } from '@/lib/modules/market/trade-aggregator'

// ── Source 1: Trade Flow ─────────────────────────────────────
export async function sourceTradeFlow(now: number): Promise<PartialSignal[]> {
  const signals: PartialSignal[] = []
  const flow = getFlowData()
  for (const f of flow.flows) {
    const totalVol = f.buyVolume + f.sellVolume
    if (totalVol < 10000) continue

    const buyRatio = f.buyVolume / totalVol
    const netFlowM = f.netFlow / 1e6

    if (buyRatio > 0.6) {
      signals.push({
        id: `flow-buy-${f.symbol}-${now}`,
        symbol: f.symbol,
        direction: 'bullish',
        strength: Math.min(90, Math.round(buyRatio * 100)),
        confidence: Math.min(80, Math.round(totalVol / 100000)),
        sources: ['trade-flow'],
        reasoning: `Strong buy pressure: ${(buyRatio * 100).toFixed(0)}% buy volume ($${netFlowM.toFixed(1)}M net inflow) across ${f.tradeCount} trades`,
        timestamp: now,
      })
    } else if (buyRatio < 0.4) {
      signals.push({
        id: `flow-sell-${f.symbol}-${now}`,
        symbol: f.symbol,
        direction: 'bearish',
        strength: Math.min(90, Math.round((1 - buyRatio) * 100)),
        confidence: Math.min(80, Math.round(totalVol / 100000)),
        sources: ['trade-flow'],
        reasoning: `Strong sell pressure: ${((1 - buyRatio) * 100).toFixed(0)}% sell volume ($${Math.abs(netFlowM).toFixed(1)}M net outflow) across ${f.tradeCount} trades`,
        timestamp: now,
      })
    }
  }
  return signals
}

// ── Source 2: Funding Rates (Binance Futures) ─────────────────
export async function sourceFundingRates(
  now: number,
): Promise<PartialSignal[]> {
  const signals: PartialSignal[] = []
  try {
    const fundingRes = await fetch(
      'https://fapi.binance.com/fapi/v1/premiumIndex',
      { signal: AbortSignal.timeout(10_000) },
    )
    if (fundingRes.ok) {
      const funding = (await fundingRes.json()) as Array<{
        symbol: string
        lastFundingRate: string
      }>
      for (const f of funding) {
        const rate = parseFloat(f.lastFundingRate)
        const symbol = f.symbol.replace('USDT', '')

        if (rate > 0.0005) {
          signals.push({
            id: `funding-bear-${symbol}-${now}`,
            symbol,
            direction: 'bearish',
            strength: Math.min(80, Math.round(rate * 100000)),
            confidence: 60,
            sources: ['funding-rate'],
            reasoning: `Extreme positive funding ${(rate * 100).toFixed(4)}% — crowded longs, potential squeeze down`,
            timestamp: now,
          })
        } else if (rate < -0.0005) {
          signals.push({
            id: `funding-bull-${symbol}-${now}`,
            symbol,
            direction: 'bullish',
            strength: Math.min(80, Math.round(Math.abs(rate) * 100000)),
            confidence: 60,
            sources: ['funding-rate'],
            reasoning: `Negative funding ${(rate * 100).toFixed(4)}% — shorts paying longs, potential squeeze up`,
            timestamp: now,
          })
        }
      }
    }
  } catch {
    /* silent */
  }
  return signals
}

// ── Source 3: Open Interest Changes ───────────────────────────
export async function sourceOpenInterest(
  now: number,
): Promise<PartialSignal[]> {
  const signals: PartialSignal[] = []
  try {
    const oiRes = await fetch(
      'https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT',
      { signal: AbortSignal.timeout(10_000) },
    )
    if (oiRes.ok) {
      const oi = (await oiRes.json()) as { openInterest: string }
      const oiValue = parseFloat(oi.openInterest)
      // High OI + high funding = crowded trade
      if (oiValue > 100000) {
        // >100K BTC
        signals.push({
          id: `oi-high-${now}`,
          symbol: 'BTC',
          direction: 'neutral',
          strength: 50,
          confidence: 45,
          sources: ['open-interest'],
          reasoning: `High open interest: ${oiValue.toFixed(0)} BTC — increased volatility likely`,
          timestamp: now,
        })
      }
    }
  } catch {
    /* silent */
  }
  return signals
}

// ── Source 4: Fear & Greed (contrarian) ──────────────────────
export async function sourceFearGreed(now: number): Promise<PartialSignal[]> {
  const signals: PartialSignal[] = []
  try {
    const fgRes = await fetch('https://api.alternative.me/fng/?limit=1', {
      signal: AbortSignal.timeout(10_000),
    })
    if (fgRes.ok) {
      const fg = (await fgRes.json()) as {
        data?: Array<{ value: string; value_classification: string }>
      }
      const score = parseInt(fg.data?.[0]?.value ?? '50')

      if (score < 20) {
        signals.push({
          id: `fg-extreme-fear-${now}`,
          symbol: 'BTC',
          direction: 'bullish',
          strength: 70,
          confidence: 65,
          sources: ['fear-greed'],
          reasoning: `Extreme Fear (${score}/100) — historically a contrarian buy signal. Market oversold.`,
          timestamp: now,
        })
      } else if (score > 80) {
        signals.push({
          id: `fg-extreme-greed-${now}`,
          symbol: 'BTC',
          direction: 'bearish',
          strength: 70,
          confidence: 65,
          sources: ['fear-greed'],
          reasoning: `Extreme Greed (${score}/100) — historically a contrarian sell signal. Market overbought.`,
          timestamp: now,
        })
      }
    }
  } catch {
    /* silent */
  }
  return signals
}

// ── Source 5: Whale Alerts ────────────────────────────────────
export async function sourceWhaleAlerts(
  now: number,
): Promise<PartialSignal[]> {
  const signals: PartialSignal[] = []
  try {
    const whaleRes = await fetch(
      'http://localhost:4400/api/v1/whale-alert',
      { signal: AbortSignal.timeout(10_000) },
    )
    if (whaleRes.ok) {
      const whaleData = (await whaleRes.json()) as {
        data?: {
          items?: Array<{
            symbol: string
            usd: number
            from: string
            to: string
          }>
        }
      }
      const alerts = whaleData.data?.items ?? []

      for (const a of alerts) {
        if (a.usd < 10_000_000) continue

        const toExchange =
          a.to.toLowerCase().includes('binance') ||
          a.to.toLowerCase().includes('coinbase') ||
          a.to.toLowerCase().includes('kraken')
        const fromExchange =
          a.from.toLowerCase().includes('binance') ||
          a.from.toLowerCase().includes('coinbase') ||
          a.from.toLowerCase().includes('kraken')

        if (toExchange) {
          signals.push({
            id: `whale-exchange-in-${now}-${Math.random().toString(36).slice(2, 4)}`,
            symbol: a.symbol,
            direction: 'bearish',
            strength: Math.min(85, Math.round(a.usd / 1000000)),
            confidence: 55,
            sources: ['whale-alert'],
            reasoning: `$${(a.usd / 1e6).toFixed(0)}M ${a.symbol} moved TO ${a.to} — potential sell pressure incoming`,
            timestamp: now,
          })
        } else if (fromExchange) {
          signals.push({
            id: `whale-exchange-out-${now}-${Math.random().toString(36).slice(2, 4)}`,
            symbol: a.symbol,
            direction: 'bullish',
            strength: Math.min(85, Math.round(a.usd / 1000000)),
            confidence: 55,
            sources: ['whale-alert'],
            reasoning: `$${(a.usd / 1e6).toFixed(0)}M ${a.symbol} moved FROM ${a.from} — accumulation, reducing sell pressure`,
            timestamp: now,
          })
        }
      }
    }
  } catch {
    /* silent */
  }
  return signals
}

// ── Source 6: Liquidation Data ────────────────────────────────
export async function sourceLiquidations(
  now: number,
): Promise<PartialSignal[]> {
  const signals: PartialSignal[] = []
  try {
    const liqRes = await fetch(
      'http://localhost:4400/api/v1/liquidations',
      { signal: AbortSignal.timeout(10_000) },
    )
    if (liqRes.ok) {
      const liqData = (await liqRes.json()) as {
        data?: {
          heatmap?: Array<{
            longLiquidations: number
            shortLiquidations: number
          }>
        }
      }
      const heatmap = liqData.data?.heatmap ?? []
      let totalLongs = 0,
        totalShorts = 0
      for (const h of heatmap) {
        totalLongs += h.longLiquidations ?? 0
        totalShorts += h.shortLiquidations ?? 0
      }
      const total = totalLongs + totalShorts

      if (total > 10_000_000) {
        // >$10M liquidations
        const longRatio = total > 0 ? totalLongs / total : 0.5
        signals.push({
          id: `liq-cascade-${now}`,
          symbol: 'BTC',
          direction: longRatio > 0.7 ? 'bullish' : 'bearish',
          strength: Math.min(75, Math.round(total / 10_000_000)),
          confidence: 50,
          sources: ['liquidations'],
          reasoning: `$${(total / 1e6).toFixed(0)}M liquidations — ${longRatio > 0.7 ? 'longs liquidated, potential bounce' : 'shorts squeezed'}`,
          timestamp: now,
        })
      }
    }
  } catch {
    /* silent */
  }
  return signals
}

// ── Source 7: Exchange Flows ──────────────────────────────────
export async function sourceExchangeFlows(
  now: number,
): Promise<PartialSignal[]> {
  const signals: PartialSignal[] = []
  try {
    const flowRes = await fetch(
      'http://localhost:4400/api/v1/exchange-flow',
      { signal: AbortSignal.timeout(10_000) },
    )
    if (flowRes.ok) {
      const flowData = (await flowRes.json()) as {
        data?: { flows?: Array<{ exchange: string; netFlow: number }> }
      }
      const flows = flowData.data?.flows ?? []
      let totalNet = 0
      for (const f of flows) {
        totalNet += f.netFlow ?? 0
      }

      if (Math.abs(totalNet) > 10_000_000) {
        // >$10M net flow
        signals.push({
          id: `exflow-${totalNet > 0 ? 'in' : 'out'}-${now}`,
          symbol: 'BTC',
          direction: totalNet > 0 ? 'bearish' : 'bullish',
          strength: Math.min(70, Math.round(Math.abs(totalNet) / 5_000_000)),
          confidence: 50,
          sources: ['exchange-flow'],
          reasoning: `$${(Math.abs(totalNet) / 1e6).toFixed(0)}M net ${totalNet > 0 ? 'inflow to' : 'outflow from'} exchanges — ${totalNet > 0 ? 'potential sell pressure' : 'accumulation'}`,
          timestamp: now,
        })
      }
    }
  } catch {
    /* silent */
  }
  return signals
}

// ── Source 8: Gas Tracker (Ethereum) ──────────────────────────
export async function sourceGasTracker(
  now: number,
): Promise<PartialSignal[]> {
  const signals: PartialSignal[] = []
  try {
    const gasRes = await fetch('http://localhost:4400/api/v1/gas', {
      signal: AbortSignal.timeout(10_000),
    })
    if (gasRes.ok) {
      const gasData = (await gasRes.json()) as {
        data?: Array<{ chain: string; standard: number; congestion: string }>
      }
      const ethGas = (Array.isArray(gasData.data) ? gasData.data : []).find(
        (g) => g.chain === 'Ethereum',
      )

      if (ethGas && ethGas.standard > 50) {
        // >50 gwei
        signals.push({
          id: `gas-high-${now}`,
          symbol: 'ETH',
          direction: 'neutral',
          strength: 40,
          confidence: 35,
          sources: ['gas-tracker'],
          reasoning: `High gas: ${ethGas.standard} gwei (${ethGas.congestion}) — network congested, DeFi activity elevated`,
          timestamp: now,
        })
      }
    }
  } catch {
    /* silent */
  }
  return signals
}

// ── Source 9: Stablecoin Flows ────────────────────────────────
export async function sourceStablecoinFlows(
  now: number,
): Promise<PartialSignal[]> {
  const signals: PartialSignal[] = []
  try {
    const stableRes = await fetch(
      'http://localhost:4400/api/v1/stablecoin-flow',
      { signal: AbortSignal.timeout(10_000) },
    )
    if (stableRes.ok) {
      const stableData = (await stableRes.json()) as {
        data?: Array<{ symbol: string; change24h: number }>
      }
      const stables = Array.isArray(stableData.data) ? stableData.data : []
      let totalChange = 0
      for (const s of stables) {
        totalChange += s.change24h ?? 0
      }

      if (Math.abs(totalChange) > 50_000_000) {
        // >$50M change
        signals.push({
          id: `stable-${totalChange > 0 ? 'mint' : 'redeem'}-${now}`,
          symbol: 'BTC',
          direction: totalChange > 0 ? 'bullish' : 'bearish',
          strength: Math.min(65, Math.round(Math.abs(totalChange) / 25_000_000)),
          confidence: 45,
          sources: ['stablecoin-flow'],
          reasoning: `$${(Math.abs(totalChange) / 1e6).toFixed(0)}M net stablecoin ${totalChange > 0 ? 'minting' : 'redemption'} — ${totalChange > 0 ? 'new capital entering' : 'capital leaving'}`,
          timestamp: now,
        })
      }
    }
  } catch {
    /* silent */
  }
  return signals
}

// ── Source 10: Derivatives Intel ──────────────────────────────
export async function sourceDerivativesIntel(
  now: number,
): Promise<PartialSignal[]> {
  const signals: PartialSignal[] = []
  try {
    const derivRes = await fetch(
      'http://localhost:4400/api/v1/derivatives-intel',
      { signal: AbortSignal.timeout(10_000) },
    )
    if (derivRes.ok) {
      const derivData = (await derivRes.json()) as {
        data?: {
          snapshots?: Array<{
            symbol: string
            fundingRate: number
            openInterest: number
          }>
        }
      }
      const snapshots = derivData.data?.snapshots ?? []

      // Find extreme funding rates on derivatives
      for (const snap of snapshots) {
        if (
          !snap.symbol.includes('BTC') && !snap.symbol.includes('ETH')
        )
          continue
        if (Math.abs(snap.fundingRate) > 0.01) {
          // >1% funding
          const symbol = snap.symbol
            .replace('USDT', '')
            .replace('USD', '')
          signals.push({
            id: `deriv-extreme-${symbol}-${now}`,
            symbol,
            direction: snap.fundingRate > 0 ? 'bearish' : 'bullish',
            strength: Math.min(
              70,
              Math.round(Math.abs(snap.fundingRate) * 1000),
            ),
            confidence: 45,
            sources: ['derivatives-intel'],
            reasoning: `Extreme ${(snap.fundingRate * 100).toFixed(2)}% funding on ${snap.symbol} — crowded ${snap.fundingRate > 0 ? 'longs' : 'shorts'}`,
            timestamp: now,
          })
        }
      }
    }
  } catch {
    /* silent */
  }
  return signals
}
