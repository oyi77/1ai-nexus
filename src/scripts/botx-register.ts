#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────
// BotX Key Registration CLI
//
// Usage:
//   npx tsx src/scripts/botx-register.ts register    Register a new key
//   npx tsx src/scripts/botx-register.ts list         List all keys
//   npx tsx src/scripts/botx-register.ts health       Check key health
//   npx tsx src/scripts/botx-register.ts rotate N     Register N new keys
//   npx tsx src/scripts/botx-register.ts stats        Show key statistics
// ─────────────────────────────────────────────────────────────

import { getCredentialManager, BotXRegistrationWorker, BotXHealthChecker } from '../lib/modules/meme/_auth/credential-manager'

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  const cm = getCredentialManager()
  const worker = new BotXRegistrationWorker(cm)
  const checker = new BotXHealthChecker(cm)

  if (!command || command === 'help') {
    console.log(`
BotX Key Registration CLI

Commands:
  register    Register a new BotX key (interactive)
  list        List all stored keys
  health      Check health of all keys
  rotate N    Register N new keys
  stats       Show key statistics
`)
    return
  }

  if (command === 'register') {
    console.log('Registering new BotX key...')
    try {
      const key = await worker.registerNewKey()
      console.log('✅ New key registered!')
      console.log('  ID:', key.id)
      console.log('  Email:', key.email)
      console.log('  API Key:', key.apiKey.slice(0, 8) + '...')
    } catch (e) {
      console.error('❌ Registration failed:', e instanceof Error ? e.message : e)
    }
    return
  }

  if (command === 'list') {
    const keys = cm.getAllKeys()
    if (keys.length === 0) {
      console.log('No keys in store')
      return
    }
    console.log(`\n${keys.length} keys in store:\n`)
    for (const k of keys) {
      const status = k.isHealthy ? (k.rateLimited ? '⏳ RATE LIMITED' : '✅ healthy') : '❌ unhealthy'
      console.log(`  ${k.id.slice(0, 8)}... | ${k.email.padEnd(30)} | ${status} | errs:${k.errorCount} reqs:${k.requestCount}`)
    }
    return
  }

  if (command === 'health') {
    console.log('Checking key health...')
    const result = await checker.checkAllKeys()
    console.log(`\n✅ ${result.healthy} healthy`)
    console.log(`⏳ ${result.rateLimited} rate limited`)
    console.log(`❌ ${result.unhealthy} unhealthy`)
    return
  }

  if (command === 'rotate') {
    const count = parseInt(args[1] || '1', 10)
    console.log(`Registering ${count} new keys...`)
    const keys = await worker.registerMultipleKeys(count)
    console.log(`\n✅ ${keys.length}/${count} keys registered successfully`)
    for (const k of keys) {
      console.log(`  ${k.id.slice(0, 8)}... | ${k.email}`)
    }
    return
  }

  if (command === 'stats') {
    const stats = cm.getStats()
    console.log('\nKey Store Statistics:')
    console.log(`  Total: ${stats.total}`)
    console.log(`  Healthy: ${stats.healthy}`)
    console.log(`  Rate Limited: ${stats.rateLimited}`)
    console.log(`  Unhealthy: ${stats.unhealthy}`)
    return
  }

  console.log(`Unknown command: ${command}`)
  process.exit(1)
}

main().catch(console.error)
