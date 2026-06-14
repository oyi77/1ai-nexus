CREATE TABLE IF NOT EXISTS nexus.whale_activity (
  chain String,
  txHash String,
  walletAddress String,
  action String,
  amountUsd Decimal32(2),
  detectedAt DateTime64(3)
) ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(detectedAt)
ORDER BY (chain, detectedAt, amountUsd DESC)
TTL detectedAt + INTERVAL 90 DAY;
