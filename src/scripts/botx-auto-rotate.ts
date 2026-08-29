#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────
// BotX Key Auto-Rotation Service
//
// Background service that:
// 1. Checks key health periodically
// 2. Auto-registers new keys when healthy count drops
// 3. Cleans up dead keys
//
// Usage:
//   npx tsx src/scripts/botx-auto-rotate.ts          Run once
//   npx tsx src/scripts/botx-auto-rotate.ts --loop   Run continuously
// ─────────────────────────────────────────────────────────────

import { getCredentialManager, BotXRegistrationWorker, BotXHealthChecker } from '../lib/modules/meme/_auth/credential-manager'

const MIN_HEALTHY_KEYS = 2
const MAX_KEYS = 10
const CHECK_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

async function runOnce() {
  const cm = getCredentialManager()
  const worker = new BotXRegistrationWorker(cm)
  const checker = new BotXHealthChecker(cm)

  const stats = cm.getStats()
  console.log(`[${new Date().toISOString()}] Key store: ${stats.healthy} healthy, ${stats.rateLimited} limited, ${stats.unhealthy} unhealthy`)

  // Check health of all keys
  const health = await checker.checkAllKeys()
  console.log(`  Health check: ${health.healthy} healthy, ${health.rateLimited} limited, ${health.unhealthy} unhealthy`)

  // If healthy keys are below minimum, register new ones
  if (health.healthy < MIN_HEALTHY_KEYS) {
    const needed = MIN_HEALTHY_KEYS - health.healthy
    console.log(`  ⚠️ Only ${health.healthy} healthy keys — registering ${needed} new keys...`)
    
    const newKeys = await worker.registerMultipleKeys(needed)
    console.log(`  ✅ Registered ${newKeys.length}/${needed} new keys`)
  }

  // Clean up unhealthy keys if we have too many
  const allKeys = cm.getAllKeys()
  if (allKeys.length > MAX_KEYS) {
    const unhealthy = allKeys.filter(k => !k.isHealthy)
    for (const k of unhealthy.slice(0, allKeys.length - MAX_KEYS)) {
      cm.removeKey(k.id)
      console.log(`  🗑️ Removed unhealthy key ${k.id.slice(0, 8)}...`)
    }
  }
}

async function main() {
  const args = process.argv.slice(2)
  const loop = args.includes('--loop')

  if (!loop) {
    await runOnce()
    return
  }

  console.log(`BotX Auto-Rotation Service started (interval: ${CHECK_INTERVAL_MS / 1000}s)`)
  console.log(`  Min healthy keys: ${MIN_HEALTHY_KEYS}`)
  console.log(`  Max keys: ${MAX_KEYS}`)

  // Run immediately
  await runOnce()

  // Then on interval
  setInterval(async () => {
    try {
      await runOnce()
    } catch (e) {
      console.error(`[${new Date().toISOString()}] Error:`, e)
    }
  }, CHECK_INTERVAL_MS)
}

main().catch(console.error)
