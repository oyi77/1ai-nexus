// ─────────────────────────────────────────────────────────────
// KOL/Axiom monitored-wallet persistence.
//
// Gate-passing wallets from the kol-monitor cron land in the plain
// `Wallet` table (chain='solana') so the existing wallet-refresh-cron can
// pick them up and harvest their on-chain buys. This module NEVER touches
// SmartMoneyWallet — classification stays with the classifier module.
//
// Persistence is per-wallet failure-isolated: one bad address must not
// block the rest of the batch, and the whole function never throws.
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'

export interface MonitoredWallet {
  address: string
  chain: 'solana'
  alias?: string | null
  labels: string[]
}

export const KOL_MONITOR_LABELS = {
  axiom: ['axiom', 'kol-monitor'],
  kolscan: ['kolscan', 'kol-monitor'],
} as const

/** Build a persistable MonitoredWallet row for a gate-passing source. */
export function toMonitoredWallet(
  address: string,
  source: keyof typeof KOL_MONITOR_LABELS,
  alias: string | null = null,
): MonitoredWallet {
  return {
    address,
    chain: 'solana',
    alias,
    labels: [...KOL_MONITOR_LABELS[source]],
  }
}

/**
 * Upsert gate-passing wallets into the Wallet table.
 *
 * Create: chain='solana', alias (nullable), labels, lastSeen=now.
 * Update: labels (overwritten with the incoming array) + lastSeen=now.
 *
 * Failures are counted, logged, and skipped — never thrown.
 */
export async function persistMonitoredWallets(
  wallets: MonitoredWallet[],
): Promise<{ upserted: number; failed: number }> {
  let upserted = 0
  let failed = 0
  for (const w of wallets) {
    try {
      await prisma.wallet.upsert({
        where: { address: w.address },
        create: {
          address: w.address,
          chain: w.chain,
          alias: w.alias ?? null,
          labels: w.labels,
          lastSeen: new Date(),
        },
        update: {
          labels: w.labels,
          lastSeen: new Date(),
        },
      })
      upserted += 1
    } catch (err) {
      failed += 1
      console.error(
        `[wallet-persist] upsert failed for ${w.address}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  return { upserted, failed }
}

/**
 * Return the addresses from `addresses` that do NOT yet carry `label` in
 * the Wallet table. Used by the cron to decide which Axiom wallets are NEW
 * (first time passing the gate) so the Telegram digest only fires once.
 * On a DB read failure, falls back to treating every address as new so the
 * alert path never goes silent because of a broken read.
 */
export async function findWalletsMissingLabel(addresses: string[], label: string): Promise<string[]> {
  const unique = [...new Set(addresses)]
  if (unique.length === 0) return []
  try {
    const rows = await prisma.wallet.findMany({
      where: { address: { in: unique }, labels: { has: label } },
      select: { address: true },
    })
    const existing = new Set(rows.map((r) => r.address))
    return unique.filter((a) => !existing.has(a))
  } catch (err) {
    console.error(
      `[wallet-persist] label lookup failed (${label}): ${err instanceof Error ? err.message : String(err)}`,
    )
    return unique
  }
}

// ── Telegram digest (pure — no I/O) ───────────────────────────

export interface KolAxiomDigestInput {
  axiom: Array<{ address: string; winRate30d: number | null; pnl30d: number | null }>
  kolscan: Array<{
    kolName: string
    outTokenSymbol: string
    outTokenAddress: string
    usdValue: number | null
    dex: string
  }>
}

function pct(v: number | null): string {
  if (v === null) return 'n/a'
  return `${(v * 100).toFixed(0)}%`
}

function signedPct(v: number | null): string {
  if (v === null) return 'n/a'
  const rounded = Math.round(v * 100)
  return `${rounded >= 0 ? '+' : ''}${rounded}%`
}

function escapeHtml(s: string | null | undefined): string {
  if (typeof s !== 'string') return ''
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Build ONE consolidated HTML digest for the sniper chat. Returns null when
 * both sources are empty. Lists at most 5 KOLScan buys and 5 Axiom wallets
 * so the message stays far below Telegram's 4096-char sendMessage cap.
 */
export function buildKolAxiomDigest(input: KolAxiomDigestInput): string | null {
  const kolscanRows = input.kolscan.slice(0, 5)
  const axiomRows = input.axiom.slice(0, 5)
  if (kolscanRows.length === 0 && axiomRows.length === 0) return null

  const lines: string[] = [
    '📡 <b>SMART MONEY / KOL RADAR</b>',
    '━━━━━━━━━━━━━━━━━━━━━━━━━',
  ]

  if (kolscanRows.length > 0) {
    lines.push(`🎯 <b>KOLScan Buys (${kolscanRows.length}):</b>`)
    for (const tx of kolscanRows) {
      const rawSymbol = tx.outTokenSymbol && tx.outTokenSymbol.trim() !== ''
        ? tx.outTokenSymbol.trim().toUpperCase()
        : tx.outTokenAddress.slice(0, 8)
      const token = rawSymbol.startsWith('$') ? rawSymbol : `$${rawSymbol}`
      const usd = tx.usdValue !== null ? `<b>$${Math.round(tx.usdValue).toLocaleString('en-US')}</b>` : 'n/a'
      const dex = escapeHtml(tx.dex)
      const kol = escapeHtml(tx.kolName)
      const mint = escapeHtml(tx.outTokenAddress)

      lines.push(`• <b>${kol}</b> bought <b>${escapeHtml(token)}</b> (${usd} · ${dex})`)
      lines.push(`  └ CA: <code>${mint}</code>`)
    }
    lines.push('')
  }

  if (axiomRows.length > 0) {
    lines.push(`⚡ <b>Axiom Wallets (${axiomRows.length}):</b>`)
    for (const w of axiomRows) {
      const shortAddr = escapeHtml(w.address.slice(0, 8))
      lines.push(
        `• <code>${shortAddr}…</code> — WR ${pct(w.winRate30d)} · PnL ${signedPct(w.pnl30d)}`,
      )
    }
  }

  return lines.join('\n').trimEnd()
}
