// NEXUS MCP tools -- derivatives.

import type { McpTool } from '../types'

export const TOOLS_DERIVATIVES: McpTool[] = [
  // ── Derivatives ────────────────────────────────────────────
  {
    name: 'nexus_get_derivatives',
    description: 'Get derivatives data (open interest, funding rates, liquidations)',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string' },
        action: { type: 'string', enum: ['open-interest', 'funding'] },
      },
    },
  },
  {
    name: 'nexus_get_hyperliquid',
    description: 'Get Hyperliquid perpetual market data',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_liquidations',
    description: 'Get recent liquidation events across exchanges',
    inputSchema: { type: 'object', properties: {} },
  },
]
