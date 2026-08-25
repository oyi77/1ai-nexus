// ─────────────────────────────────────────────────────────────
// IDX Universe Harvester — snapshots the full IDX listed-equity
// universe into data/idx/universe.json.
//
// Source: TradingView Indonesia stock scanner (plain HTTPS, no
// browser needed). The runtime provider hits this source live;
// this snapshot exists purely as an outage fallback.
//
// Run: npm run harvest:idx-universe    (one shot)
// Schedule: user crontab, e.g.
//   17 */6 * * * cd /home/openclaw/projects/1ai-tracker && npm run harvest:idx-universe >> /tmp/idx-universe-harvest.log 2>&1
// ─────────────────────────────────────────────────────────────

import { mkdirSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'

const OUT_FILE = join(process.cwd(), 'data', 'idx', 'universe.json')
const SCAN_URL = 'https://scanner.tradingview.com/indonesia/scan'

// Columns in order: ticker, company name, sector, industry.
const ScanResponse = z.object({
  totalCount: z.number(),
  data: z.array(z.object({
    s: z.string(),
    d: z.array(z.string()),
  })),
})

async function main() {
  const res = await fetch(SCAN_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(20_000),
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
    },
    body: JSON.stringify({
      filter: [{ left: 'type', operation: 'equal', right: 'stock' }],
      options: { lang: 'en' },
      columns: ['name', 'description', 'sector', 'industry'],
      range: [0, 3000],
    }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const parsed = ScanResponse.parse(await res.json())

  const stocks = parsed.data.map((row) => ({
    symbol: `${row.d[0] || row.s.replace('IDX:', '')}.JK`,
    name: row.d[1],
    sector: row.d[2],
    industry: row.d[3],
  }))
  if (stocks.length === 0) throw new Error('scanner returned no listings')

  const snapshot = {
    capturedAt: new Date().toISOString(),
    source: 'tradingview-indonesia-scan',
    count: stocks.length,
    stocks,
  }

  mkdirSync(join(process.cwd(), 'data', 'idx'), { recursive: true })
  const tmp = `${OUT_FILE}.tmp`
  writeFileSync(tmp, JSON.stringify(snapshot))
  renameSync(tmp, OUT_FILE)

  console.log(`[idx-universe] ${stocks.length}/${parsed.totalCount} stocks → ${OUT_FILE}`)
}

main().catch((err) => {
  console.error('[idx-universe] harvest failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
