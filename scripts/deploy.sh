#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Safe deploy for 1ai-tracker:
#   1. Typecheck
#   2. Test
#   3. Build to completion
#   4. Restart PM2
#   5. Verify deploy parity (served chunk == built chunk)
#
# Fails fast at any step. NEVER restart before build completes.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

cd "$(dirname "$0")/.."

ORIGIN="${DEPLOY_ORIGIN:-https://tracker.aitradepulse.com}"
CHUNK_PATH="${DEPLOY_CHUNK_PATH:-/}"

echo "=== [1/5] typecheck ==="
npx tsc --noEmit

echo "=== [2/5] tests ==="
npx vitest run --reporter=basic

echo "=== [3/5] build ==="
npx next build --turbopack
echo "build complete"

echo "=== [4/5] restart PM2 ==="
pm2 restart 1ai-tracker-web
sleep 10

CHUNK_TYPES=("js" "css")
PARITY_FAILED=0
for EXT in "${CHUNK_TYPES[@]}"; do
  CHUNK_REL=$(curl -s "$ORIGIN$CHUNK_PATH" | grep -oE "_next/static/chunks/[^\"]+\.${EXT}" | sort -u | head -1)
  if [ -z "$CHUNK_REL" ]; then
    echo "WARN: no .${EXT} chunk referenced by $ORIGIN$CHUNK_PATH — skipping"
    continue
  fi
  LOCAL_FILE=".next/static/chunks/$(basename "$CHUNK_REL")"
  if [ ! -f "$LOCAL_FILE" ]; then
    echo "PARITY FAIL: served .$EXT chunk is not present in the freshly built .next output: $LOCAL_FILE"
    echo "The running process is likely serving a stale build. Recovery: restart after build completion: pm2 restart 1ai-tracker-web"
    PARITY_FAILED=1
    continue
  fi
  LOCAL_MD5=$(md5sum "$LOCAL_FILE" | cut -d' ' -f1)
  SERVED_CODE=$(curl -s -o /tmp/_parity_chunk -w '%{http_code}' "$ORIGIN/$CHUNK_REL")
  SERVED_MD5=$(md5sum /tmp/_parity_chunk 2>/dev/null | cut -d' ' -f1 || echo "FETCH_FAIL")
  echo "chunk: $CHUNK_REL (HTTP $SERVED_CODE)"
  echo "local : $LOCAL_MD5"
  echo "served: $SERVED_MD5"
  if [ "$SERVED_CODE" != "200" ] || [ "$LOCAL_MD5" != "$SERVED_MD5" ]; then
    echo "PARITY FAIL: served .$EXT chunk does not match freshly built chunk"
    PARITY_FAILED=1
  fi
done
if [ "$PARITY_FAILED" != "0" ]; then
  echo "PARITY FAIL: rebuild→restart ordering broken?"
  echo "Recovery: wait for build completion, then: pm2 restart 1ai-tracker-web"
  exit 1
fi
echo "PARITY OK: served == built (js + css)"

echo "=== deploy complete ==="
