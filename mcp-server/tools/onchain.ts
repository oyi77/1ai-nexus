// NEXUS MCP tools -- onchain.

import type { McpTool } from '../types'

export const TOOLS_ONCHAIN: McpTool[] = [
  // ── On-Chain Intelligence ──────────────────────────────────
  {
    name: 'nexus_get_whale_cluster',
    description: 'Get whale cluster data for major exchanges (Binance, Coinbase, Kraken, OKX)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_exchange_flow',
    description: 'Get exchange flow intelligence (whale deposits/withdrawals)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_mempool',
    description: 'Get Bitcoin mempool stats, congestion, and fee levels',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['stats', 'whale', 'all', 'blocks', 'hashrate'] },
      },
    },
  },
  {
    name: 'nexus_get_insider',
    description: 'Get insider/suspicious wallet detection alerts',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_gas',
    description: 'Get gas prices across chains (BTC, ETH, L2s, SOL)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_stablecoin_flow',
    description: 'Get stablecoin (USDT, USDC, DAI) flow data',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_stablecoins',
    description: 'Get stablecoin peg status and market data',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_rugcheck',
    description: 'Get rug-pull risk scores for tokens',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_macro_onchain',
    description: 'Get BTC on-chain macro metrics (MVRV, SOPR, NVT)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_correlations',
    description: 'Get cross-asset correlation data',
    inputSchema: { type: 'object', properties: {} },
  },
]
