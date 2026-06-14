# Runner Commands
## Install deps
```bash
cd ~/projects/1ai-tracker/indexer && npm install
cp ../../.env.example .env
npx prisma db push
```

## Start services
```bash
docker compose up -d redis postgres clickhouse
```

## Indexer
```bash
cd ~/projects/1ai-tracker/indexer
USE_BATCH_INDEXER=1 npx tsx main.ts
```

## WS server
```bash
cd ~/projects/1ai-tracker/ws-server
npx tsx server.ts
```

## Health
```bash
cd ~/projects/1ai-tracker/indexer
npx tsx -e "import { WatermarkStore } from './core/watermark'; import { DedupeGate } from './core/dedupe'; import { startEthereumBatchIndexer } from './core/evm-batch-indexer'; import { handleIncomingTx } from './processors/transaction'; console.log('OK')"
```
