#!/usr/bin/env tsx
/**
 * RE Module Verification Script
 *
 * Runs healthCheck() on every module with sourceType === 're'
 * Reports pass/fail/degraded status in a table
 * Updates lastVerified in file headers when modules pass
 *
 * Usage: npx tsx src/scripts/verify-re-modules.ts [--fix]
 */

import { registerAllModules } from '../lib/modules'
import * as fs from 'node:fs'
import * as path from 'node:path'

// ─── File path map: module id → source file ──────────────────
// Kept in sync manually; each RE module file has a JSDoc header
// with `lastVerified: <ISO date>` that gets updated via --fix.
const MODULE_FILE_MAP: Record<string, string> = {
  'birdeye-re':         'src/lib/modules/onchain/birdeye/tokens.ts',
  'arkham-re':          'src/lib/modules/onchain/arkham/entities.ts',
  'finnhub-re':         'src/lib/modules/macro/finnhub/calendar.ts',
  'cryptopanic-re':     'src/lib/modules/news/cryptopanic/posts.ts',
  'benzinga-re':        'src/lib/modules/news/benzinga/news.ts',
  'santiment-re':       'src/lib/modules/sentiment/santiment/metrics.ts',
  'alpha-vantage-re':   'src/lib/modules/equities/alpha-vantage/prices.ts',
  'fmp-re':             'src/lib/modules/equities/fmp/prices.ts',
  'yahoo-finance':      'src/lib/modules/equities/yahoo/quotes.ts',
  'metals-re':          'src/lib/modules/commodities/metals/prices.ts',
  'eastmoney':          'src/lib/modules/market/eastmoney/prices.ts',
  'sectors-app':        'src/lib/modules/market/sectors-app.ts',
  'defillama-research': 'src/lib/modules/news/defillama/research.ts',
  'vimero-feed-proxy':  'src/lib/modules/news/vimero/feed.ts',
  'gateio-performance': 'src/lib/modules/derivatives/gateio/performance.ts',
  'gateio-copy-leaderboard': 'src/lib/modules/market/gateio-copy/leaderboard.ts',
  'hyperliquid-copy-leaderboard': 'src/lib/modules/market/hyperliquid-copy/leaderboard.ts',
}

// ─── TTY helpers ──────────────────────────────────────────────

const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const CYAN = '\x1b[36m'
const GRAY = '\x1b[90m'
const DIM = '\x1b[2m'

function colorStatus(status: string): string {
  switch (status) {
    case 'active':   return `${GREEN}● active${RESET}`
    case 'degraded': return `${YELLOW}● degraded${RESET}`
    case 'offline':  return `${RED}● offline${RESET}`
    default:         return `${GRAY}${status}${RESET}`
  }
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

// ─── Types ────────────────────────────────────────────────────

interface HealthResult {
  id: string
  name: string
  category: string
  fragility: string
  lastVerified: string
  daysSinceVerify: number
  stale: boolean
  status: string
  failureCount: number
  notes?: string
}

// ─── Main ─────────────────────────────────────────────────────

async function main() {
  const fix = process.argv.includes('--fix')

  console.log(`\n  ${BOLD}${CYAN}RE Module Verification${RESET}${DIM}  —  ${new Date().toISOString()}${RESET}\n`)

  // 1. Register all modules
  const registry = registerAllModules()
  const allModules = registry.getAll()
  const reModules = allModules.filter(m => m.sourceType === 're')

  if (reModules.length === 0) {
    console.log(`  ${YELLOW}No RE modules found in registry${RESET}`)
    process.exit(1)
  }

  console.log(`  ${BOLD}Total modules:${RESET} ${allModules.length}  |  ${BOLD}RE modules:${RESET} ${reModules.length}\n`)

  // 2. Run health checks
  const results: HealthResult[] = []
  let passed = 0
  let failed = 0
  let degraded = 0

  for (const mod of reModules) {
    const daysSinceVerify = mod.provenance.lastVerified
      ? Math.floor((Date.now() - new Date(mod.provenance.lastVerified).getTime()) / 86_400_000)
      : 999

    process.stdout.write(`  ${GRAY}→${RESET} ${mod.id}${DIM}...${RESET}`)

    try {
      const health = await Promise.race([
        mod.healthCheck(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 10_000)
        ),
      ])

      results.push({
        id: mod.id,
        name: mod.name,
        category: mod.category,
        fragility: mod.provenance.fragility,
        lastVerified: mod.provenance.lastVerified,
        daysSinceVerify,
        stale: daysSinceVerify > 7,
        status: health.status,
        failureCount: health.failureCount,
        notes: health.notes,
      })

      if (health.status === 'active') {
        passed++
        process.stdout.write(` ${GREEN}✓ active${RESET}\n`)
      } else if (health.status === 'degraded') {
        degraded++
        process.stdout.write(` ${YELLOW}⚠ degraded${RESET}${health.notes ? ` ${DIM}(${health.notes})${RESET}` : ''}\n`)
      } else {
        failed++
        process.stdout.write(` ${RED}✗ ${health.status}${RESET}${health.notes ? ` ${DIM}(${health.notes})${RESET}` : ''}\n`)
      }
    } catch (err) {
      failed++
      const msg = err instanceof Error ? err.message : String(err)
      results.push({
        id: mod.id,
        name: mod.name,
        category: mod.category,
        fragility: mod.provenance.fragility,
        lastVerified: mod.provenance.lastVerified,
        daysSinceVerify,
        stale: daysSinceVerify > 7,
        status: 'offline',
        failureCount: 1,
        notes: msg,
      })
      process.stdout.write(` ${RED}✗ offline${RESET}${DIM} (${msg})${RESET}\n`)
    }
  }

  // 3. Summary table — manually formatted with colors in headings only
  console.log(`\n  ${BOLD}Results${RESET}\n`)

  // Header
  const padRight = (s: string, w: number) => String(s).padEnd(w)
  const hdr = (s: string) => `${BOLD}${s}${RESET}`
  const colW = { id: 22, name: 28, cat: 14, frag: 10, verified: 16, status: 10, fail: 8 }
  const sep = `  ${GRAY}${'─'.repeat(colW.id + colW.name + colW.cat + colW.frag + colW.verified + colW.status + colW.fail + 12)}${RESET}`

  console.log(`  ${hdr('Module'.padEnd(colW.id))} ${hdr('Name'.padEnd(colW.name))} ${hdr('Category'.padEnd(colW.cat))} ${hdr('Fragility'.padEnd(colW.frag))} ${hdr('Verified'.padEnd(colW.verified))} ${hdr('Status'.padEnd(colW.status))} ${hdr('Failures')}`)
  console.log(sep)

  for (const r of results) {
    const v = r.lastVerified ? `${r.lastVerified}`.padEnd(colW.verified) : `${RED}never${RESET}`.padEnd(colW.verified)
    const s = colorStatus(r.status)
    const f = String(r.failureCount).padStart(colW.fail)
    console.log(
      `  ${padRight(r.id, colW.id)} ${padRight(r.name, colW.name)} ${padRight(r.category, colW.cat)} ${padRight(r.fragility, colW.frag)} ${v} ${s}  ${f}`
    )
  }

  console.log(sep)

  // Notes for degraded/failed modules
  const hasNotes = results.filter(r => r.notes)
  if (hasNotes.length > 0) {
    console.log(`\n  ${DIM}Notes:${RESET}`)
    for (const r of hasNotes) {
      console.log(`    ${DIM}•${RESET} ${r.id}: ${r.notes}`)
    }
  }

  // 4. Stale module warning
  const staleModules = results.filter(r => r.stale)
  if (staleModules.length > 0) {
    console.log(`\n  ${YELLOW}⚠ ${staleModules.length} module(s) haven't been verified in 7+ days:${RESET}`)
    for (const m of staleModules) {
      console.log(`    ${YELLOW}•${RESET} ${m.id}  ${DIM}(last verified ${m.lastVerified} — ${m.daysSinceVerify}d ago)${RESET}`)
    }
  }

  // 5. --fix: update lastVerified in file headers
  if (fix) {
    console.log(`\n  ${BOLD}${CYAN}--fix mode: updating lastVerified headers${RESET}\n`)
    const projectRoot = path.resolve(__dirname, '../..')
    let updated = 0
    let notFound = 0

    for (const r of results) {
      if (r.status !== 'active') {
        console.log(`  ${YELLOW}⚠${RESET} Skipping ${r.id} ${DIM}(status: ${r.status} — not updating lastVerified)${RESET}`)
        continue
      }

      const relPath = MODULE_FILE_MAP[r.id]
      if (!relPath) {
        console.log(`  ${YELLOW}?${RESET} ${r.id} ${DIM}(no file mapping — skipping)${RESET}`)
        notFound++
        continue
      }

      const absPath = path.join(projectRoot, relPath)
      if (!fs.existsSync(absPath)) {
        console.log(`  ${YELLOW}?${RESET} ${r.id} ${DIM}(file not found: ${relPath})${RESET}`)
        notFound++
        continue
      }

      const original = fs.readFileSync(absPath, 'utf-8')
      // Update the lastVerified line in the JSDoc header
      const updatedContent = original.replace(
        /(\s*\*\s*lastVerified:\s*)\d{4}-\d{2}-\d{2}/,
        `$1${todayISO()}`
      )

      if (updatedContent !== original) {
        fs.writeFileSync(absPath, updatedContent, 'utf-8')
        console.log(`  ${GREEN}✓${RESET} ${r.id}  ${DIM}→ lastVerified updated to ${todayISO()}${RESET}`)
        updated++
      } else {
        // lastVerified already today or pattern not found
        if (original.includes(`lastVerified: ${todayISO()}`)) {
          console.log(`  ${GRAY}−${RESET} ${r.id}  ${DIM}(already ${todayISO()})${RESET}`)
        } else {
          console.log(`  ${YELLOW}?${RESET} ${r.id}  ${DIM}(lastVerified pattern not found in ${relPath})${RESET}`)
          notFound++
        }
      }
    }

    console.log(`\n  ${GREEN}${updated} file(s) updated${RESET}${notFound > 0 ? `, ${notFound} not found/skipped` : ''}`)
  }

  // 6. Exit code
  console.log(`\n  ${BOLD}Summary:${RESET} ${GREEN}${passed} passed${RESET}, ${YELLOW}${degraded} degraded${RESET}, ${RED}${failed} failed${RESET}  |  ${reModules.length} total RE modules\n`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error(`\n  ${RED}Fatal error:${RESET}`, err)
  process.exit(1)
})
