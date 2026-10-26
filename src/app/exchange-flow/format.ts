/**
 * Number formatting helpers shared by the exchange-flow page and tests.
 * Carved out of page.tsx so the Next.js page constraint (only route
 * exports allowed) does not break the content-integrity test import.
 */
export function fmtUsd(n: number | null | undefined): string {
  if (!Number.isFinite(n)) return '—'
  const value = n as number
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(1)}M`
  if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}

export function fmtPercent(n: number | null | undefined): string {
  return Number.isFinite(n) ? `${(n as number) >= 0 ? '+' : ''}${(n as number).toFixed(2)}%` : '—'
}
