# Hardening Checklist (Production)

## 1. Retries & Circuit Breakers
- `publishEvent`: 3 retries, exponential backoff (200ms → 1.2s → 3s)
- Prisma: `prisma.$transaction` with timeout 5s
- WS RPC: max 8s timeout, reconnect 3s jitter

## 2. Structured Logging
- Use `pino` or `winston` for JSON logs
- Fields: `stream`, `chain`, `txHash`, `ingestedAt`, `error`
- Target: `indexer/core/*`, `indexer/processors/*`

## 3. Metrics
- `_c latency`: histogram of `handleIncomingTx` duration
- `_pub latency`: histogram of `publishEvent` round-trip
- `_backfill lag`: gauge of `(headBlock - watermark.lastBlock)`
- Expose via `/metrics` endpoint

## 4. Testing
- Unit: `handleIncomingTx` (mock bus + prisma)
- Integration: watermark + dedup (test TS -> tsc --noEmit)
- Health: `USE_BATCH_INDEXER=1 npx tsx main.ts` 5s smoke

## 5. Deployment
- `docker-compose.yml` services: redis, postgres, clickhouse, indexer, ws-server
- Env: `REDIS_URL`, `DATABASE_URL`, `CLICKHOUSE_URL`, `USE_BATCH_INDEXER`
- Health checks: TCP on 6379 (redis), 5432 (postgres), 8123 (clickhouse)
