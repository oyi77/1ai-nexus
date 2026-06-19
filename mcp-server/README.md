# NEXUS MCP Server

Model Context Protocol server for NEXUS Terminal. Exposes all data modules as MCP tools for AI agents.

## Quick Start

```bash
# Standalone
cd mcp-server && npm install && npm start

# Docker Compose (recommended)
docker compose up mcp-server
```

Server runs on port **4402** by default.

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check + tool count |
| `/sse` | GET | SSE stream for remote agents |
| `/mcp` | POST | MCP JSON-RPC endpoint |

## Available Tools

| Tool | Description |
|------|-------------|
| `nexus_get_whale_alerts` | Large transactions across chains |
| `nexus_get_market_snapshot` | Prices, dominance, market cap |
| `nexus_get_fear_greed` | Crypto Fear & Greed Index |
| `nexus_get_defi_tvl` | DeFiLlama protocol TVL |
| `nexus_get_dex_pools` | GeckoTerminal trending pools |
| `nexus_get_macro_indicators` | FRED rates, CPI, GDP |
| `nexus_get_news_feed` | Aggregated RSS news |
| `nexus_get_derivatives` | OI, funding, liquidations |
| `nexus_get_prediction_markets` | Polymarket data |
| `nexus_trace_wallet` | Wallet profile + tx history |
| `nexus_get_token_intelligence` | Token holder analysis |
| `nexus_get_module_status` | Module health status |

## Usage with Claude Code

```json
{
  "mcpServers": {
    "nexus": {
      "url": "http://localhost:4402/sse"
    }
  }
}
```

## Auth

Bearer token via `NEXUS_API_KEYS` environment variable (same as web server).

## Architecture

```
MCP Client (Claude Code, etc.)
    ↓ JSON-RPC / SSE
MCP Server (port 4402)
    ↓ HTTP
NEXUS Web API (port 4400)
    ↓ ModuleRegistry
Data Modules (30+)
```

All tools are auto-generated from the ModuleRegistry. No hand-written tool definitions.
