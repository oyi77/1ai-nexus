# 1ai-tracker Production Rollout Runbook

## Runtime toggles

- `USE_BATCH_INDEXER=1` -> batch EVM indexer with watermark + dedup
- `USE_BATCH_INDEXER=0` -> legacy per-wallet mode (rollback)

## Database

- `prisma/schema.prisma` -> apply committed migrations with `npx prisma migrate deploy`
- `schemas/enriched.prisma` is a reference schema; it is not the production Prisma migration entrypoint
- `db/clickhouse-init.sql` is mounted by Compose into `/docker-entrypoint-initdb.d/init.sql` and initializes ClickHouse on a fresh data volume
- Never use `npx prisma migrate dev` or `db push` for production rollout

## Service startup

```bash
npm ci  # stage vendor/1ai-payment-0.1.0.tgz first; see docs/HANDOVER.md §2
npm --prefix indexer ci
npm --prefix ws-server ci
npx prisma migrate deploy
docker compose up -d redis postgres clickhouse
npm --prefix indexer run dev   # separate terminal; USE_BATCH_INDEXER=1 enables batch mode
npm --prefix ws-server run dev # separate terminal
```

## Verification

```bash
cd indexer && npx tsx -e "import { WatermarkStore } from './core/watermark'; import { DedupeGate } from './core/dedupe'; import { startEthereumBatchIndexer } from './core/evm-batch-indexer'; import { handleIncomingTx } from './processors/transaction'; console.log('OK')"
```
