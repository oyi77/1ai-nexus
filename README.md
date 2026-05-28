# NEXUS — Open-Source Crypto Whale Tracker & On-Chain Intelligence Platform

Real-time blockchain analytics for tracking whale movements, smart money flows, and on-chain activity across **Ethereum, Solana, Bitcoin, Arbitrum, Base, and Optimism**. Zero API keys required — runs entirely on free public RPC endpoints.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](docker-compose.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](tsconfig.json)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](package.json)

---

## What is NEXUS?

NEXUS is an **open-source crypto intelligence platform** that monitors blockchain transactions in real-time to identify whale activity, smart money movements, and significant on-chain events. Built for traders, analysts, and developers who need actionable blockchain data without expensive API subscriptions.

### Key Capabilities

- **Whale Wallet Tracking** — Monitor large holders across 6 blockchain networks
- **Smart Money Detection** — AI-powered scoring identifies accumulation, distribution, and exit patterns
- **Entity Mapping** — Connect wallets to known entities (exchanges, funds, protocols, whales)
- **Flow Analysis** — Visualize capital flows between entities and chains
- **Real-Time Alerts** — Custom conditions with webhook delivery and HMAC signing
- **Prediction Markets** — Crypto prediction market interface with order book and leaderboards
- **DeFi Protocol Analytics** — Track TVL, yields, and protocol-level activity

---

## Supported Blockchains

| Chain | Type | Endpoint | API Key |
|-------|------|----------|---------|
| Ethereum | WebSocket | `wss://ethereum-rpc.publicnode.com` | Free |
| Arbitrum | WebSocket | `wss://arbitrum-one-rpc.publicnode.com` | Free |
| Base | WebSocket | `wss://base-rpc.publicnode.com` | Free |
| Optimism | WebSocket | `wss://optimism-rpc.publicnode.com` | Free |
| Solana | WebSocket | `wss://api.mainnet-beta.solana.com` | Free |
| Bitcoin | REST Polling | `https://blockstream.info/api` | Free |

---

## Quick Start

### Docker Compose (Recommended)

One command starts everything — PostgreSQL, Redis, database seeding, Next.js app, WebSocket server, and blockchain indexer:

```bash
git clone https://github.com/oyi77/1ai-tracker.git
cd 1ai-tracker/nexus
docker compose up --build
```

This boots 5 services:

| Service | Port | Description |
|---------|------|-------------|
| `postgres` | 5432 | PostgreSQL 16 database |
| `redis` | 6379 | Redis Pub/Sub event bus |
| `db-init` | — | Runs once: schema push + seed (50 entities, 500 markets, 10K trades) |
| `web` | 3000 | Next.js 16 application |
| `ws` | 3001 | WebSocket sidecar (Socket.io) |
| `indexer` | — | Multi-chain blockchain indexer |

Open [http://localhost:3000](http://localhost:3000) — login with `admin` / `admin`.

### Local Development

```bash
# Prerequisites: Node.js 20+, PostgreSQL 16, Redis 7
brew services start postgresql@16
docker-compose up -d redis

# Install and setup
npm install
npm run db:push
npm run db:seed

# Run
npm run dev          # Next.js on :3000
cd ws-server && npm run dev  # WebSocket on :3001
cd indexer && npm run dev    # Blockchain indexer
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    NEXUS Platform                        │
├──────────────┬──────────────┬───────────────────────────┤
│  Next.js 16  │  WS Sidecar  │    Blockchain Indexer     │
│  (Port 3000) │  (Port 3001) │    (ETH/SOL/BTC/ARB/OP)  │
├──────────────┴──────────────┴───────────────────────────┤
│                    Redis Pub/Sub                         │
├─────────────────────────────────────────────────────────┤
│                    Prisma 6 ORM                          │
├─────────────────────────────────────────────────────────┤
│              PostgreSQL 16 + Redis 7                     │
└─────────────────────────────────────────────────────────┘
```

### Tech Stack

- **Frontend**: Next.js 16, React 19, Tailwind CSS 4, Recharts, Socket.io-client
- **Backend**: Next.js API Routes, Prisma 6 ORM, Zod validation
- **Real-Time**: Socket.io WebSocket sidecar, Redis Pub/Sub event bus
- **Blockchain**: Standard JSON-RPC subscriptions (`eth_subscribe`), Solana WebSocket API, Bitcoin REST polling
- **Database**: PostgreSQL 16, Redis 7
- **Auth**: NextAuth.js with credentials provider
- **Infrastructure**: Docker Compose, multi-stage builds

---

## API Documentation

### REST API (v1)

All endpoints require Bearer token authentication.

```
GET  /api/v1/entities          — List tracked entities (whales, funds, exchanges)
GET  /api/v1/tokens            — Token analytics and rankings
GET  /api/v1/flows             — Capital flow data between entities
GET  /api/v1/smart-money       — Smart money signals and scores
GET  /api/v1/predictions       — Prediction market data
GET  /api/v1/alerts            — User alert configurations
GET  /api/v1/wallets/:address  — Individual wallet analytics
```

### WebSocket Events

Connect to `ws://localhost:3001` with Bearer token:

```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:3001", {
  auth: { token: "your-api-key" }
});

// Real-time trade events
socket.on("trade", (data) => {
  console.log(`${data.chain}: ${data.from} → ${data.to}`);
});

// Smart money signals
socket.on("smart-money", (signal) => {
  console.log(`${signal.type}: ${signal.entity} score=${signal.score}`);
});
```

---

## Project Structure

```
nexus/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── (dashboard)/        # Dashboard layout group
│   │   ├── api/                # REST API routes
│   │   ├── dashboard/          # Main dashboard
│   │   ├── entities/           # Entity explorer
│   │   ├── smart-money/        # Smart money signals
│   │   ├── flows/              # Capital flow visualization
│   │   ├── predictions/        # Prediction markets
│   │   ├── tokens/             # Token analytics
│   │   └── alerts/             # Alert management
│   ├── components/             # React components
│   │   ├── domain/             # Business domain components
│   │   ├── entity/             # Entity cards, graphs, tables
│   │   ├── predictions/        # Market cards, order books
│   │   └── ui/                 # Shared UI primitives
│   └── lib/                    # Shared utilities
│       ├── alerts/             # Alert engine (evaluator, delivery)
│       ├── api/                # API middleware (auth, rate-limit)
│       ├── events/             # Redis event publisher
│       └── ws/                 # WebSocket client
├── indexer/                    # Blockchain indexer (separate process)
│   ├── chains/                 # Chain-specific listeners
│   │   ├── ethereum.ts         # ETH/ARB/BASE/OP via eth_subscribe
│   │   ├── solana.ts           # SOL via accountSubscribe
│   │   └── bitcoin.ts          # BTC via Blockstream REST polling
│   ├── processors/             # Transaction decoding & smart money detection
│   └── publisher.ts            # Redis event publisher
├── ws-server/                  # WebSocket sidecar (separate process)
│   ├── server.ts               # Socket.io server
│   ├── auth.ts                 # Bearer token authentication
│   └── subscriber.ts           # Redis event subscriber
├── prisma/
│   ├── schema.prisma           # Database schema (12 models)
│   └── seed.ts                 # Seed script (50 entities, 500 markets)
└── docker-compose.yml          # Unified Docker Compose (5 services)
```

---

## Database Schema

12 models covering the full intelligence stack:

- **Entity** — Tracked organizations (whales, funds, exchanges, protocols)
- **Wallet** — Blockchain addresses linked to entities
- **Trade** — Decoded on-chain transactions with smart money scoring
- **Flow** — Capital movement between entities
- **Signal** — Smart money detection events
- **PredictionMarket** — Crypto prediction markets
- **MarketPosition** — User positions in prediction markets
- **Alert** — User-configured alert conditions
- **AlertDelivery** — Alert webhook delivery log
- **IndexerCheckpoint** — Blockchain sync state per chain
- **Token** — Tracked token metadata
- **User** — Authentication and API key management

---

## Configuration

All configuration via environment variables. Zero required for local development with Docker Compose.

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://nexus:nexus@postgres:5432/nexus` | PostgreSQL connection |
| `REDIS_URL` | `redis://redis:6379` | Redis connection |
| `NEXTAUTH_SECRET` | `nexus-dev-secret` | Session encryption key |
| `NEXUS_API_KEYS` | `nexus-dev-key` | WebSocket auth keys |
| `ETH_WS_URL` | `wss://ethereum-rpc.publicnode.com` | Ethereum WebSocket RPC |
| `SOLANA_WS_URL` | `wss://api.mainnet-beta.solana.com` | Solana WebSocket RPC |
| `LOG_LEVEL` | `info` | Indexer log verbosity |

Override any RPC endpoint to use your own node infrastructure:

```bash
# .env
ETH_WS_URL=wss://your-own-eth-node.example.com
SOLANA_WS_URL=wss://your-own-solana-rpc.example.com
```

---

## Use Cases

### For Crypto Traders
- Track whale wallet movements before they impact price
- Get real-time alerts when smart money accumulates or distributes
- Monitor capital flows between exchanges and DeFi protocols

### For On-Chain Analysts
- Map wallet clusters to known entities
- Analyze transaction patterns across multiple chains
- Build custom dashboards with real-time data feeds

### For Developers
- Integrate whale tracking into your trading bot via WebSocket API
- Build custom alert systems using the REST API
- Extend the indexer with new chains or transaction types

### For Researchers
- Study whale behavior patterns and market impact
- Analyze smart money timing relative to price movements
- Track prediction market accuracy over time

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run tests: `npm test`
5. Submit a pull request

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Related Projects

- [PolyEdge Trading Bot](https://github.com/oyi77/1ai-poly-trader) — Plugin-based trading bot with NEXUS integration
- [Blockstream API](https://github.com/Blockstream/esplora) — Bitcoin blockchain explorer API
- [Public Node](https://publicnode.com) — Free public blockchain RPC endpoints

---

**Keywords**: crypto whale tracker, on-chain analytics, blockchain intelligence, smart money detection, whale wallet tracking, DeFi analytics, real-time blockchain monitoring, Ethereum analytics, Solana analytics, Bitcoin analytics, crypto transaction tracker, whale alert, on-chain data platform, open-source crypto analytics
