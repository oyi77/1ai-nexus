import 'dotenv/config'
import { recordPipelineRun } from '@/lib/modules/derived/pipeline-heartbeat'
import { runSmartMoneySync } from '@/lib/modules/derived/smart-money-sync'

async function main() {
  console.log(`[smart-money-sync-cron] ${new Date().toISOString()} — starting`)
  const result = await runSmartMoneySync()
  console.log(`[smart-money-sync-cron] done:`, JSON.stringify(result))
  await recordPipelineRun(
    'smart-money-sync',
    result.sheetWritten,
    `synced=${result.walletsSynced} trades=${result.tradesFound} sent=${result.alertsSent} sheet=${result.sheetWritten}`,
  )
  process.exit(0)
}

main().catch((err) => {
  console.error('[smart-money-sync-cron] FATAL:', err)
  void recordPipelineRun('smart-money-sync', false, `FATAL: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
