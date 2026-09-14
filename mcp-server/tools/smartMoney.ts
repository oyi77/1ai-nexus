// NEXUS MCP tools -- smartMoney.

import type { McpTool } from '../types'

export const TOOLS_SMARTMONEY: McpTool[] = [
  // ── Smart Money ────────────────────────────────────────────
  {
    name: 'nexus_get_smart_money',
    description: 'Get smart money wallets ranked by score',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'nexus_get_smart_money_flow',
    description: 'Get smart money flow by entity category (CEX, VC, whale, DeFi)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_trace_wallet',
    description: 'Get wallet profile with entity label, tx history, and token transfers',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string' },
        chain: { type: 'string' },
      },
      required: ['address'],
    },
  },
  {
    name: 'nexus_get_entity',
    description: 'Get entity label and wallet profile for an address',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string' },
        chain: { type: 'string' },
      },
      required: ['address'],
    },
  },
  {
    name: 'nexus_get_entities',
    description: 'Get all labeled entities (exchanges, VCs, whales, protocols)',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'nexus_get_flows',
    description: 'Get capital flows between entities',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_copy_trade',
    description: 'Get copy-trading signals from smart money activity',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_pnl',
    description: 'Get PnL leaderboard or wallet-specific PnL',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string' },
        chain: { type: 'string' },
        leaderboard: { type: 'string', enum: ['true', 'false'] },
        limit: { type: 'number' },
      },
    },
  },
]
