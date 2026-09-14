// NEXUS MCP tools -- aiSystem.

import type { McpTool } from '../types'

export const TOOLS_AISYSTEM: McpTool[] = [
  // ── AI & Signals ───────────────────────────────────────────
  {
    name: 'nexus_get_signals',
    description: 'Get correlated cross-source intelligence signals',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_signal_confidence',
    description: 'Get signal confidence scores',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_edge_report',
    description: 'Get daily edge report with actionable signals',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_alpha_feed',
    description: 'Get alpha signals from edge report + news',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_chat',
    description: 'Send a message to the NEXUS AI assistant',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        agent: { type: 'string', description: 'Agent: whale, macro, rug, narrative, portfolio' },
      },
      required: ['message'],
    },
  },

  // ── Predictions ────────────────────────────────────────────
  {
    name: 'nexus_get_prediction_markets',
    description: 'Get Polymarket/Manifold prediction market data',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
  },

  // ── Alerts ─────────────────────────────────────────────────
  {
    name: 'nexus_get_alerts',
    description: 'Get active alerts (requires API key)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_alert_templates',
    description: 'Get available alert templates',
    inputSchema: { type: 'object', properties: {} },
  },

  // ── System ─────────────────────────────────────────────────
  {
    name: 'nexus_get_status',
    description: 'Get system status and service health',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_data_sources',
    description: 'Get health status of all data sources',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_module_status',
    description: 'Get status of all 58+ data modules',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_telegram',
    description: 'Get Telegram bot status',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_get_usage',
    description: 'Get API usage statistics',
    inputSchema: { type: 'object', properties: {} },
  },
]
