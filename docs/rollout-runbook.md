# 1ai-tracker Production Rollout Runbook
## Week 1–6 Completion & Deployment Order

Runtime toggles
- USE_BATCH_INDEXER=1 -> batch EVM indexer with watermark + dedup
- USE_BATCH_INDEXER=0 -> legacy per-wallet mode (rollback)

Database
- schemas/enriched.prisma -> apply via `npx prisma migrate dev`
- db/clickhouse-init.sql -> init ClickHouse before enabling TS writes

Service startup
- Start Redis + Postgres (+ ClickHouse)
- cd indexer && USE_BATCH_INDEXER=1 npx tsx main.ts
- cd ws-server && npx tsx server.ts

Verification
- cd indexer && npx tsx -e "import { WatermarkStore } from './core/watermark'; import { DedupeGate } from './core/dedupe'; import { startEthereumBatchIndexer } from './core/evm-batch-indexer'; import { handleIncomingTx } from './processors/transaction'; console.log('OK')"
