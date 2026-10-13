// ─────────────────────────────────────────────────────────────
// GMGN Tag Inventory — one-shot sweep of GMGN's Solana wallet
// leaderboard tags so the whale harvester knows exactly which
// `tag=` values are worth sweeping.
//
// Run: node --import tsx src/scripts/gmgn-tag-inventory.ts
//
// Probes every candidate tag on the 30d window, then re-probes
// the top few tags on 7d. Records per-tag row/winrate/pnl counts,
// computes the global address dedupe across tags, prints a table
// sorted by uniqueWithWinRate desc, and writes the result to
// data/gmgn-tag-inventory.json (gitignored).
//
// Rate limit: 800ms minimum between API calls. Per-tag failures
// are tolerated (rows=0 + error string) and never abort the run.
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { listGmgnWalletRank, type GmgnWalletRankRow } from '@/lib/modules/meme/gmgn'

const CANDIDATE_TAGS = [
  'smart_degen',
  'pump_smart_degen',
  'sniper',
  'kol',
  'axiom',
  'whale',
  'launchpad_smart',
  'top_followed',
  'wash_trader',
  'bluechip_owner',
  'app_smart_money',
  'arbitrager',
  'gmgn_go',
  'fomo',
  'padre',
  'trojan',
  'bullx',
  'photon',
] as const

const DELAY_MS = 800
const TOP_N_FOR_7D = 5
const DATA_DIR = join(process.cwd(), 'data')
const OUT_PATH = join(DATA_DIR, 'gmgn-tag-inventory.json')

type Window = '30d' | '7d'

interface TagProbe {
  tag: string
  window: Window
  rows: number
  uniqueAddresses: number
  rowsWithWinRate: number
  uniqueWithWinRate: number
  rowsWithPnl: number
  error: string | null
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

function summarize(
  tag: string,
  window: Window,
  rows: GmgnWalletRankRow[],
  error: string | null,
): TagProbe {
  const withWinRate = rows.filter((r) => r.winRate30d !== null)
  const withPnl = rows.filter((r) => r.pnl30d !== null)
  return {
    tag,
    window,
    rows: rows.length,
    uniqueAddresses: new Set(rows.map((r) => r.address)).size,
    rowsWithWinRate: withWinRate.length,
    uniqueWithWinRate: new Set(withWinRate.map((r) => r.address)).size,
    rowsWithPnl: withPnl.length,
    error,
  }
}

async function probeTag(
  tag: string,
  window: Window,
): Promise<{ rows: GmgnWalletRankRow[]; probe: TagProbe }> {
  let rows: GmgnWalletRankRow[] = []
  let error: string | null = null
  try {
    rows = await listGmgnWalletRank(tag, window)
    if (rows.length === 0) {
      error = 'no rows returned (endpoint empty/refused)'
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }
  return { rows, probe: summarize(tag, window, rows, error) }
}

function printTable(title: string, probes: TagProbe[]): void {
  const headers = ['TAG', 'WINDOW', 'ROWS', 'UNIQUE', 'ROWS_WR', 'UNIQ_WR', 'ROWS_PNL']
  const rows = probes.map((p) => [
    p.tag,
    p.window,
    String(p.rows),
    String(p.uniqueAddresses),
    String(p.rowsWithWinRate),
    String(p.uniqueWithWinRate),
    String(p.rowsWithPnl),
  ])
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))
  const line = (cells: string[]): string =>
    cells
      .map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i])))
      .join('  ')

  console.log(`\n${title}`)
  console.log(line(headers))
  console.log(headers.map((_, i) => '-'.repeat(widths[i])).join('  '))
  for (const r of rows) console.log(line(r))
  for (const p of probes) {
    if (p.error) console.log(`  ! ${p.tag}/${p.window}: ${p.error}`)
  }
}

async function main(): Promise<void> {
  console.log(
    `[gmgn-tag-inventory] probing ${CANDIDATE_TAGS.length} tags on 30d (${DELAY_MS}ms between calls)…`,
  )

  const probes30d: TagProbe[] = []
  const dedupe = new Map<string, boolean>()
  const pnlDedupe = new Set<string>()

  for (let i = 0; i < CANDIDATE_TAGS.length; i++) {
    const tag = CANDIDATE_TAGS[i]
    if (i > 0) await delay(DELAY_MS)
    const { rows, probe } = await probeTag(tag, '30d')
    probes30d.push(probe)
    for (const r of rows) {
      const prev = dedupe.get(r.address)
      dedupe.set(r.address, prev === true || r.winRate30d !== null)
      if (r.pnl30d !== null) pnlDedupe.add(r.address)
    }
    console.log(
      `  ${tag}: ${probe.rows} rows, ${probe.uniqueWithWinRate} unique w/ winrate` +
        (probe.error ? ` — ${probe.error}` : ''),
    )
  }

  const sorted30d = [...probes30d].sort((a, b) => b.uniqueWithWinRate - a.uniqueWithWinRate)
  const topTags = sorted30d.slice(0, TOP_N_FOR_7D).map((p) => p.tag)

  const probes7d: TagProbe[] = []
  console.log(
    `\n[gmgn-tag-inventory] probing top ${topTags.length} tags on 7d: ${topTags.join(', ')}…`,
  )
  for (let i = 0; i < topTags.length; i++) {
    await delay(DELAY_MS)
    const { probe } = await probeTag(topTags[i], '7d')
    probes7d.push(probe)
    console.log(
      `  ${topTags[i]}: ${probe.rows} rows, ${probe.uniqueWithWinRate} unique w/ winrate` +
        (probe.error ? ` — ${probe.error}` : ''),
    )
  }

  const totalUnique = dedupe.size
  const uniqueWithWin = [...dedupe.values()].filter(Boolean).length

  printTable('GMGN TAG INVENTORY — 30d sweep (sorted by uniqueWithWinRate desc)', sorted30d)
  if (probes7d.length > 0) {
    const sorted7d = [...probes7d].sort((a, b) => b.uniqueWithWinRate - a.uniqueWithWinRate)
    printTable('GMGN TAG INVENTORY — 7d probes (top tags)', sorted7d)
  }

  console.log(
    `\nGLOBAL DEDUPE (30d): ${totalUnique} unique addresses across all tags, ` +
      `${uniqueWithWin} carry winrate, ${pnlDedupe.size} carry pnl`,
  )

  const result = {
    generatedAt: new Date().toISOString(),
    note: 'GMGN Solana wallet leaderboard tag inventory — one-shot sweep',
    delayMs: DELAY_MS,
    probes30d,
    probes7d,
    globalDedupe30d: {
      totalUniqueAddresses: totalUnique,
      uniqueWithWinRate: uniqueWithWin,
      uniqueWithPnl: pnlDedupe.size,
    },
  }
  await mkdir(DATA_DIR, { recursive: true })
  await writeFile(OUT_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(`Wrote ${OUT_PATH}`)
}

main().catch((err) => {
  console.error(
    `[gmgn-tag-inventory] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`,
  )
  process.exitCode = 1
})
