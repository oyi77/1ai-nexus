// NEXUS MCP tools -- tokensDefi.

import type { McpTool } from '../types'

export const TOOLS_TOKENSDEFI: McpTool[] = [
  // ── Tokens ─────────────────────────────────────────────────
  {
    name: 'nexus_get_tokens',
    description: 'Get token list with prices, market cap, volume',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        chain: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'nexus_get_token_discover',
    description: 'Discover new tokens with rug scoring and smart money analysis',
    inputSchema: {
      type: 'object',
      properties: {
        sort: { type: 'string', enum: ['trending', 'volume', 'new', 'liquidity'] },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'nexus_get_exchanges',
    description: 'Get exchange list and data',
    inputSchema: { type: 'object', properties: {} },
  },

  // ── DeFi ───────────────────────────────────────────────────
  {
    name: 'nexus_get_defi_tvl',
    description: 'Get DeFi protocol TVL rankings from DeFiLlama',
    inputSchema: {
      type: 'object',
      properties: {
        chain: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'nexus_get_defi_yields',
    description: 'Get DeFi yield pools sorted by APY',
    inputSchema: {
      type: 'object',
      properties: {
        chain: { type: 'string' },
        stablecoin: { type: 'string', enum: ['true', 'false'] },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'nexus_get_defi_overview',
    description: 'Get comprehensive DeFi overview (chains, DEX volumes, stablecoins, fees, yields)',
    inputSchema: { type: 'object', properties: {} },
  },
]
