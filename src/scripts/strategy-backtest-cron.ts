#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Strategy Backtest Cron — Replay historical candidates against
// the operator's THREE live entry strategies (Second Wave, Level Flip, Whale Comeback).
//
// Run:
//   npm run backtest:strategies
//   BACKTEST_LIMIT=30 npm run backtest:strategies
// ─────────────────────────────────────────────────────────────

import 'dotenv/config'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { runStrategyBacktest } from '@/lib/modules/derived/strategy-backtest'
import { recordPipelineRun } from '@/lib/modules/derived/pipeline-heartbeat'

const REPORT_PATH = join(process.cwd(), 'data', 'strategy-backtest-latest.json')

function numEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

async function main(): Promise<void> {
  const limit = numEnv('BACKTEST_LIMIT', 20)
  const source = (process.env.BACKTEST_SOURCE as 'launch_token' | 'call_feed' | 'both') || 'both'

  console.log(`[strategy-backtest] starting backtest run (limit=${limit}, source=${source})...`)

  try {
    const report = await runStrategyBacktest({ limit, source })

    try {
      mkdirSync(join(process.cwd(), 'data'), { recursive: true })
      writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8')
      console.log(`[strategy-backtest] saved artifact to ${REPORT_PATH}`)
    } catch (err) {
      console.warn(`[strategy-backtest] artifact write failed: ${String(err)}`)
    }

    console.log('\n' + report.summaryMarkdown + '\n')

    void recordPipelineRun(
      'strategy-backtest',
      true,
      `replayed=${report.totalReplayed} fired=${report.firedCount} hitRate=${report.hitRatePct}%`,
    )
    process.exit(0)
  } catch (err) {
    console.error('[strategy-backtest] fatal error:', err)
    void recordPipelineRun(
      'strategy-backtest',
      false,
      `FATAL: ${err instanceof Error ? err.message : String(err)}`,
    )
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('[strategy-backtest] unexpected unhandled rejection:', err)
  process.exit(1)
})
