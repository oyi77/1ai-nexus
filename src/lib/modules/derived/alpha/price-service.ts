// ─────────────────────────────────────────────────────────────
// Alpha Signal Engine — Price & Kline Data Fetching
// Binance REST API data sources
// ─────────────────────────────────────────────────────────────

import type { PriceData, KlinesData } from './types'

/**
 * Fetch current 24hr ticker prices from Binance for crypto symbols
 */
export async function fetchCurrentPrices(
  symbols: string[],
): Promise<Record<string, PriceData>> {
  const priceMap: Record<string, PriceData> = {}
  if (symbols.length === 0) return priceMap

  // Filter to likely Binance symbols (uppercase, no special chars)
  const binanceSymbols = symbols.filter((s) => /^[A-Z0-9]+$/.test(s))
  if (binanceSymbols.length === 0) return priceMap

  // Fetch prices in parallel (batch of 10 to avoid rate limits)
  const batchSize = 10
  for (let i = 0; i < binanceSymbols.length; i += batchSize) {
    const batch = binanceSymbols.slice(i, i + batchSize)
    const promises = batch.map(async (symbol) => {
      try {
        const res = await fetch(
          `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}USDT`,
          { signal: AbortSignal.timeout(5_000) },
        )
        if (!res.ok) return

        const data = (await res.json()) as {
          symbol: string
          lastPrice: string
          highPrice: string
          lowPrice: string
        }

        priceMap[symbol] = {
          symbol,
          price: parseFloat(data.lastPrice),
          high24h: parseFloat(data.highPrice),
          low24h: parseFloat(data.lowPrice),
        }
      } catch {
        /* symbol not on Binance */
      }
    })

    await Promise.all(promises)
  }

  return priceMap
}

/**
 * Fetch 15 daily klines from Binance for ATR 14-period calculation
 */
export async function fetchKlines(
  symbols: string[],
): Promise<Map<string, KlinesData>> {
  const map = new Map<string, KlinesData>()
  const valid = symbols.filter((s) => /^[A-Z0-9]+$/.test(s))
  const batchSize = 10
  for (let i = 0; i < valid.length; i += batchSize) {
    const batch = valid.slice(i, i + batchSize)
    await Promise.all(
      batch.map(async (symbol) => {
        try {
          const res = await fetch(
            `https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1d&limit=15`,
            { signal: AbortSignal.timeout(5000) },
          )
          if (!res.ok) return
          const raw = (await res.json()) as string[][]
          if (raw.length < 2) return
          map.set(symbol, {
            symbol,
            closes: raw.map((k) => parseFloat(k[4])),
            highs: raw.map((k) => parseFloat(k[2])),
            lows: raw.map((k) => parseFloat(k[3])),
          })
        } catch {
          /* skip */
        }
      }),
    )
  }
  return map
}
