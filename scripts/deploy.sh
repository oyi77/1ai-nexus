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

echo "=== [5/5] deploy parity check ==="
CHUNK_REL=$(curl -s "$ORIGIN$CHUNK_PATH" | grep -oE '_next/static/chunks/[^"]+\.js' | sort -u | head -1)
if [ -z "$CHUNK_REL" ]; then
  echo "WARN: could not find a chunk to compare"
  exit 0
fi
LOCAL_MD5=$(md5sum ".next/static/chunks/$(basename "$CHUNK_REL")" 2>/dev/null | cut -d' ' -f1 || echo "MISSING")
SERVED_MD5=$(curl -s "$ORIGIN$CHUNK_REL" | md5sum | cut -d' ' -f1)
echo "chunk: $CHUNK_REL"
echo "local : $LOCAL_MD5"
echo "served: $SERVED_MD5"
if [ "$LOCAL_MD5" != "$SERVED_MD5" ]; then
  echo "PARITY FAIL: served bundle does not match freshly built bundle"
  exit 1
fi
echo "PARITY OK: served == built"

echo "=== deploy complete ==="
