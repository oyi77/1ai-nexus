// ─────────────────────────────────────────────────────────────
// Stablecoin Flow Tracker — USDT/USDC mint/burn as macro signal
// Net mint = bullish (new money entering), net burn = bearish
// ─────────────────────────────────────────────────────────────

interface StablecoinFlow {
  name: string
  symbol: string
  currentSupply: number
  change24h: number
  change7d: number
  netFlow: number // positive = mint, negative = burn
  signal: 'bullish' | 'bearish' | 'neutral'
}

const DEFI_LLAMA_URL = 'https://stablecoins.llama.fi'

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export async function getStablecoinFlows(): Promise<StablecoinFlow[]> {
  try {
    const data = await fetchJson<{ peggedAssets: Array<{ name: string; symbol: string; circulating: { current: number }; circulatingPrevDay: { current: number }; circulatingPrevWeek: { current: number } }> }>(`${DEFI_LLAMA_URL}/stablecoins`)

    return data.peggedAssets
      .filter(a => a.circulating?.current > 1_000_000) // Only >$1M supply
      .map(a => {
        const current = a.circulating?.current || 0
        const prevDay = a.circulatingPrevDay?.current || current
        const prevWeek = a.circulatingPrevWeek?.current || current
        const change24h = current - prevDay
        const change7d = current - prevWeek

        return {
          name: a.name,
          symbol: a.symbol,
          currentSupply: current,
          change24h,
          change7d,
          netFlow: change24h,
          signal: change24h > 1_000_000 ? 'bullish' as const : change24h < -1_000_000 ? 'bearish' as const : 'neutral' as const,
        }
      })
      .sort((a, b) => b.currentSupply - a.currentSupply)
      .slice(0, 20)
  } catch {
    return []
  }
}

export async function getNetMintBurn(): Promise<{ totalMint24h: number; totalBurn24h: number; netFlow24h: number; signal: string }> {
  const flows = await getStablecoinFlows()
  const totalMint = flows.filter(f => f.change24h > 0).reduce((s, f) => s + f.change24h, 0)
  const totalBurn = flows.filter(f => f.change24h < 0).reduce((s, f) => s + Math.abs(f.change24h), 0)
  const net = totalMint - totalBurn

  return {
    totalMint24h: totalMint,
    totalBurn24h: totalBurn,
    netFlow24h: net,
    signal: net > 10_000_000 ? 'bullish — new money entering' : net < -10_000_000 ? 'bearish — money leaving' : 'neutral',
  }
}
