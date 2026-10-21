// ─────────────────────────────────────────────────────────────
// Pure decision logic for the zero-issue audit.
//
// The audit script talks to the network, PM2 and Telegram, so it cannot be
// unit-tested as-is — which left the repo's main guard with no coverage at
// all. Everything that decides WHETHER to alert, and WHAT the alert says,
// lives here instead, so it can be tested without a side effect.
//
// The rule this encodes: alert on NEW failures only, so a long-running
// incident does not re-alert every 15 minutes, but a NEW break still gets
// through immediately.
// ─────────────────────────────────────────────────────────────

export interface AuditCheckResult {
  name: string
  ok: boolean
  detail: string
}

/** Which failures are new since the previous run. */
export function newFailures(
  current: AuditCheckResult[],
  previousFailures: string[],
): string[] {
  const currentIds = current.filter((c) => !c.ok).map((c) => c.name)
  return currentIds.filter((id) => !previousFailures.includes(id))
}

/**
 * Build the Telegram alert body.
 *
 * Returns null when there is nothing to report (no failures) — the caller
 * must not send an "all good" message every 15 minutes.
 */
export function buildAlertMessage(
  current: AuditCheckResult[],
  totalChecks: number,
  previousFailures: string[],
): string | null {
  const failures = current.filter((c) => !c.ok)
  if (failures.length === 0) return null

  const ids = failures.map((f) => f.name)
  const fresh = newFailures(current, previousFailures)
  const lines = [
    `🔴 [1ai-tracker] zero-issue audit: ${failures.length}/${totalChecks} check(s) FAILED`,
    ...failures.map((f) => `  • ${f.name}: ${f.detail}`),
    fresh.length
      ? `new since last run: ${fresh.join(', ')}`
      : '(same failures as previous run — no new regressions)',
  ]
  // Keep the ids available to the caller for the state file.
  void ids
  return lines.join('\n')
}

/**
 * Whether the audit should send a Telegram alert.
 *
 * A new failure always alerts. A failure that was already known does not
 * re-alert — but a failure that has RECOVERED and come back is new again
 * (the state file only carries the currently-failing ids, so a recovered
 * check is no longer in previousFailures).
 */
export function shouldAlert(
  current: AuditCheckResult[],
  previousFailures: string[],
): boolean {
  const failures = current.filter((c) => !c.ok)
  if (failures.length === 0) return false
  return newFailures(current, previousFailures).length > 0
}
