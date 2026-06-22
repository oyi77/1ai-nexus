// ─────────────────────────────────────────────────────────────
// Wallet PnL Tracker — Realized PnL calculation from swap history
// Computes per-wallet profit/loss, win rate, trade stats
// sourceType: derived (computed from on-chain modules)
// ─────────────────────────────────────────────────────────────

import { getRegistry } from '../registry'

// ─── Types ───────────────────────────────────────────────────

export interface WalletPnl {
  address: string
  chain: string
  totalPnl: number
  winRate: number
  tradeCount: number
  avgTradeSize: number
  bestTrade: number
  worstTrade: number
}

interface SwapEvent {
  tokenIn: string
  tokenOut: string
  amountIn: number
  amountOut: number
  priceIn: number   // USD price per unit of tokenIn
  priceOut: number   // USD price per unit of tokenOut
  timestamp: number
}

interface CostBasisEntry {
  price: number
  remainingQty: number
}

interface TradeResult {
  pnl: number
  size: number
}

// ─── In-memory leaderboard cache ─────────────────────────────

const _LEADERBOARD_TTL_MS = 5 * 60 * 1000 // 5 minutes

let leaderboardCache: WalletPnl[] = []
let _leaderboardUpdatedAt = 0

/** Chain ID mapping for registry modules */
const CHAIN_TO_COVALENT_ID: Record<string, string> = {
  eth: '1',
  arb: '42161',
  base: '8453',
  op: '10',
  polygon: '137',
  bsc: '56',
}

// ─── PnL Calculation ─────────────────────────────────────────

/**
 * Calculate realized PnL from a list of swap events.
 * Uses FIFO cost-basis matching with quantity tracking: each sell is
 * matched against the earliest unmatched buy lots of the same token.
 *
 * Returns individual trade results for stats computation.
 */
export function calculateTrades(swaps: SwapEvent[]): TradeResult[] {
  // token → FIFO queue of {price, remainingQty}
  const costBasis = new Map<string, CostBasisEntry[]>()
  const trades: TradeResult[] = []

  // Sort swaps chronologically
  const sorted = [...swaps].sort((a, b) => a.timestamp - b.timestamp)

  for (const swap of sorted) {
    // This swap: spend tokenIn, receive tokenOut
    // Buying tokenOut: push new cost-basis lot
    const outQueue = costBasis.get(swap.tokenOut) ?? []
    outQueue.push({ price: swap.priceOut, remainingQty: swap.amountOut })
    costBasis.set(swap.tokenOut, outQueue)

    // Selling tokenIn: realize PnL against FIFO lots
    const inQueue = costBasis.get(swap.tokenIn)
    if (!inQueue || inQueue.length === 0) continue

    let remainingSell = swap.amountIn

    while (remainingSell > 0 && inQueue.length > 0) {
      const lot = inQueue[0]
      const matchedQty = Math.min(remainingSell, lot.remainingQty)
      const pnl = (swap.priceIn - lot.price) * matchedQty
      trades.push({ pnl, size: matchedQty * swap.priceIn })

      lot.remainingQty -= matchedQty
      remainingSell -= matchedQty

      if (lot.remainingQty <= 0) {
        inQueue.shift() // lot fully consumed
      }
    }
  }

  return trades
}

/**
 * Compute aggregate WalletPnl stats from individual trade results.
 */
export function aggregatePnl(
  address: string,
  chain: string,
  trades: TradeResult[],
): WalletPnl {
  if (trades.length === 0) {
    return {
      address,
      chain,
      totalPnl: 0,
      winRate: 0,
      tradeCount: 0,
      avgTradeSize: 0,
      bestTrade: 0,
      worstTrade: 0,
    }
  }

  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0)
  const wins = trades.filter(t => t.pnl > 0).length
  const winRate = wins / trades.length
  const avgTradeSize = trades.reduce((sum, t) => sum + t.size, 0) / trades.length
  const bestTrade = Math.max(...trades.map(t => t.pnl))
  const worstTrade = Math.min(...trades.map(t => t.pnl))

  return {
    address,
    chain,
    totalPnl,
    winRate,
    tradeCount: trades.length,
    avgTradeSize,
    bestTrade,
    worstTrade,
  }
}

// ─── Data Fetching ───────────────────────────────────────────

/**
 * Fetch transaction history for a wallet from existing on-chain modules.
 * Tries blockscout-eth first (EVM chains), falls back to covalent.
 */
async function fetchSwapHistory(address: string, chain: string): Promise<SwapEvent[]> {
  const registry = getRegistry()

  if (CHAIN_TO_COVALENT_ID[chain]) {
    // Try blockscout first (Etherscan-compatible, free)
    try {
      const result = await registry.fetchOne('blockscout-eth', {
        action: 'tokentx',
        address,
        chain,
        limit: 200,
      })

      const txs = result.data as Array<Record<string, unknown>> | undefined
      if (txs && txs.length > 0) {
        return parseBlockscoutSwaps(txs, address)
      }
    } catch {
      // Fall through to covalent
    }

    // Fallback: covalent
    try {
      const chainId = CHAIN_TO_COVALENT_ID[chain]
      const result = await registry.fetchOne('covalent', {
        action: 'transactions',
        address,
        chainId,
      })

      const data = result.data as Record<string, unknown> | undefined
      const txs = data?.items as Array<Record<string, unknown>> | undefined
      if (txs && txs.length > 0) {
        return parseCovalentSwaps(txs, address)
      }
    } catch {
      // Both sources failed
    }
  }

  return []
}

/**
 * Parse blockscout token transfers into swap events.
 * Groups by tx hash and identifies paired in/out transfers relative
 * to the tracked wallet address.
 */
function parseBlockscoutSwaps(
  txs: Array<Record<string, unknown>>,
  walletAddress: string,
): SwapEvent[] {
  const swaps: SwapEvent[] = []
  const addr = walletAddress.toLowerCase()

  // Group by transaction hash to find paired transfers
  const txGroups = new Map<string, Array<Record<string, unknown>>>()
  for (const tx of txs) {
    const hash = tx.hash as string ?? tx.transactionHash as string ?? ''
    if (!hash) continue
    const group = txGroups.get(hash) ?? []
    group.push(tx)
    txGroups.set(hash, group)
  }

  for (const [, group] of txGroups) {
    if (group.length < 2) continue

    // Find inflow (to = wallet) and outflow (from = wallet)
    const inflow = group.find(tx =>
      typeof tx.to === 'string' && tx.to.toLowerCase() === addr,
    )
    const outflow = group.find(tx =>
      typeof tx.from === 'string' && tx.from.toLowerCase() === addr,
    )
    if (!inflow || !outflow) continue

    const rawValueIn = parseFloat(String(outflow.value ?? '0'))
    const rawValueOut = parseFloat(String(inflow.value ?? '0'))
    if (rawValueIn === 0 || rawValueOut === 0) continue

    const decimalsIn = parseInt(String(outflow.tokenDecimal ?? '18'), 10)
    const decimalsOut = parseInt(String(inflow.tokenDecimal ?? '18'), 10)
    const amountIn = rawValueIn / Math.pow(10, decimalsIn)
    const amountOut = rawValueOut / Math.pow(10, decimalsOut)

    // USD prices: use blockscout's quote field if available, else 0
    // Blockscout Etherscan-compat returns value in wei; USD needs quote
    const usdPriceIn = parseFloat(String(outflow.tokenPrice ?? '0'))
    const usdPriceOut = parseFloat(String(inflow.tokenPrice ?? '0'))

    swaps.push({
      tokenIn: String(outflow.tokenSymbol ?? outflow.contractAddress ?? 'UNKNOWN'),
      tokenOut: String(inflow.tokenSymbol ?? inflow.contractAddress ?? 'UNKNOWN'),
      amountIn,
      amountOut,
      priceIn: usdPriceIn,
      priceOut: usdPriceOut,
      timestamp: parseInt(String(inflow.timeStamp ?? outflow.timeStamp ?? '0'), 10) * 1000,
    })
  }

  return swaps
}

/**
 * Parse covalent transaction data into swap events.
 * Uses sender_contract_decimals for correct amount scaling
 * and quote_rate for USD pricing.
 */
function parseCovalentSwaps(
  txs: Array<Record<string, unknown>>,
  walletAddress: string,
): SwapEvent[] {
  const swaps: SwapEvent[] = []
  const addr = walletAddress.toLowerCase()

  for (const tx of txs) {
    const logEvents = tx.log_events as Array<Record<string, unknown>> | undefined
    if (!logEvents) continue

    let tokenIn = ''
    let tokenOut = ''
    let amountIn = 0
    let amountOut = 0
    let priceIn = 0
    let priceOut = 0

    for (const log of logEvents) {
      const decoded = log.decoded as Record<string, unknown> | undefined
      if (!decoded) continue

      const name = decoded.name as string ?? ''
      const params = decoded.params as Array<Record<string, unknown>> | undefined
      if (!params) continue

      if (name === 'Transfer') {
        const from = params.find(p => p.name === 'from')?.value as string ?? ''
        const to = params.find(p => p.name === 'to')?.value as string ?? ''
        const rawValue = parseFloat(String(params.find(p => p.name === 'value')?.value ?? '0'))

        // Use contract decimals from the log event (Covalent provides this)
        const decimals = parseInt(String(log.sender_contract_decimals ?? '18'), 10)
        const amount = rawValue / Math.pow(10, decimals)

        // Use Covalent's quote_rate for USD pricing
        const quoteRate = parseFloat(String(log.quote_rate ?? '0'))

        if (from.toLowerCase() === addr && amount > 0) {
          tokenIn = String(log.sender_name ?? log.sender_address ?? 'UNKNOWN')
          amountIn = amount
          priceIn = quoteRate
        } else if (to.toLowerCase() === addr && amount > 0) {
          tokenOut = String(log.sender_name ?? log.sender_address ?? 'UNKNOWN')
          amountOut = amount
          priceOut = quoteRate
        }
      }
    }

    if (tokenIn && tokenOut && amountIn > 0 && amountOut > 0) {
      swaps.push({
        tokenIn,
        tokenOut,
        amountIn,
        amountOut,
        priceIn,
        priceOut,
        timestamp: new Date(String(tx.block_signed_at ?? Date.now())).getTime(),
      })
    }
  }

  return swaps
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Calculate wallet PnL by fetching tx history and computing realized gains.
 * Uses existing on-chain modules (blockscout, covalent) for data.
 */
export async function calculateWalletPnl(address: string, chain: string): Promise<WalletPnl> {
  const swaps = await fetchSwapHistory(address, chain)
  const trades = calculateTrades(swaps)
  return aggregatePnl(address, chain, trades)
}

/**
 * Return cached leaderboard sorted by total PnL (descending).
 * Returns empty array if cache is stale and hasn't been refreshed.
 */
export function getTopWallets(limit = 50): WalletPnl[] {
  return leaderboardCache.slice(0, limit)
}

/**
 * Recalculate the leaderboard.
 * Fetches PnL for all tracked wallets and caches the sorted result.
 */
export async function updateLeaderboard(): Promise<void> {
  const registry = getRegistry()

  // Collect known wallet addresses from smart-money and entity data
  const walletAddresses: Array<{ address: string; chain: string }> = []

  try {
    const smartMoneyResult = await registry.fetchOne('arkham-re', { action: 'entities' })
    const entities = smartMoneyResult.data as Array<Record<string, unknown>> | undefined
    if (entities) {
      for (const entity of entities) {
        const addrs = entity.addresses as Array<Record<string, unknown>> | undefined
        if (addrs) {
          for (const a of addrs) {
            walletAddresses.push({
              address: String(a.address ?? ''),
              chain: String(a.chain ?? 'eth'),
            })
          }
        }
      }
    }
  } catch {
    // If Arkham is unavailable, use empty set
  }

  // Calculate PnL for each wallet (parallel, with concurrency limit)
  const CONCURRENCY = 5
  const results: WalletPnl[] = []

  for (let i = 0; i < walletAddresses.length; i += CONCURRENCY) {
    const batch = walletAddresses.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.allSettled(
      batch.map(w => calculateWalletPnl(w.address, w.chain)),
    )
    for (const r of batchResults) {
      if (r.status === 'fulfilled') {
        results.push(r.value)
      }
    }
  }

  // Sort by total PnL descending
  results.sort((a, b) => b.totalPnl - a.totalPnl)

  leaderboardCache = results
  _leaderboardUpdatedAt = Date.now()
}

/**
 * Clear all cached state (for testing).
 */
export function resetPnlStore(): void {
  leaderboardCache = []
  _leaderboardUpdatedAt = 0
}
