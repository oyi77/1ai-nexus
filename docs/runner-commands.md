# Runner Commands

Run these commands from the repository root (`1ai-tracker`, not the historical `1ai-nexus` path). Use committed lockfiles for reproducible installs. Database schema changes use committed migrations; do not use `db push` on a migrated database.

## Install deps

```bash
npm ci  # stage vendor/1ai-payment-0.1.0.tgz first; see docs/HANDOVER.md §2
npm --prefix indexer ci
npm --prefix ws-server ci
cp .env.example .env  # edit required values; never commit secrets
npx prisma migrate deploy
```

## Start services

```bash
docker compose up -d redis postgres clickhouse
```

## Indexer

```bash
cd indexer
USE_BATCH_INDEXER=1 npx tsx main.ts
```

## WS server

```bash
cd ws-server
npx tsx server.ts
```

## Health

```bash
cd indexer
npx tsx -e "import { WatermarkStore } from './core/watermark'; import { DedupeGate } from './core/dedupe'; import { startEthereumBatchIndexer } from './core/evm-batch-indexer'; import { handleIncomingTx } from './processors/transaction'; console.log('OK')"
```
