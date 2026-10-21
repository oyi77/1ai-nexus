// ─────────────────────────────────────────────────────────────
// Pipeline heartbeats — the liveness record for scheduled jobs.
//
// A cron that stops running looks exactly like a cron that has nothing to
// report. That is how a broken sheet sync survived for hours: the log said
// "rewritten" while the write had silently failed, and nothing in the app
// could tell the operator.
//
// So every scheduled pipeline records a heartbeat here after each run —
// success AND failure. The zero-issue audit reads them and reports a job as
// failed when its heartbeat is stale (it stopped) or marked not-ok (it ran
// and failed).
//
// Storage is StateMeta (DB-primary, JSON backup) under one scope, so a
// heartbeat is a single row read, not a pile of files.
// ─────────────────────────────────────────────────────────────

import { loadStateMeta, saveStateMeta } from '@/lib/modules/derived/db-state-meta'

const SCOPE = 'pipeline-heartbeat'

export interface PipelineHeartbeat {
  /** Epoch ms of the last completed run. */
  at: number
  /** Whether that run succeeded. */
  ok: boolean
  /** Short human-readable outcome. Never empty when ok=false. */
  detail: string
}

export type PipelineHeartbeats = Record<string, PipelineHeartbeat>

/** Pipelines the audit expects to see a recent heartbeat from. */
export interface PipelineExpectation {
  name: string
  /** A run older than this many ms means the job stopped. */
  maxAgeMs: number
}

/**
 * The pipelines that must be alive, with the age past which a job counts as
 * stopped. The ages follow the real schedule: a job that runs every 15
 * minutes must have been seen within ~2 intervals.
 */
export const EXPECTED_PIPELINES: PipelineExpectation[] = [
  { name: 'whale-buy-scan', maxAgeMs: 40 * 60_000 },
  { name: 'kol-monitor', maxAgeMs: 20 * 60_000 },
  { name: 'whale-harvester', maxAgeMs: 26 * 60 * 60_000 },
  { name: 'wallet-refresh', maxAgeMs: 26 * 60 * 60_000 },
  { name: 'token-holdings', maxAgeMs: 26 * 60 * 60_000 },
  { name: 'smart-money-sync', maxAgeMs: 40 * 60_000 },
  { name: 'feed-health', maxAgeMs: 40 * 60_000 },
  { name: 'confluence', maxAgeMs: 40 * 60_000 },
  { name: 'accumulation-alert', maxAgeMs: 40 * 60_000 },
  { name: 'wallet-discovery', maxAgeMs: 40 * 60_000 },
]

export async function readPipelineHeartbeats(): Promise<PipelineHeartbeats> {
  return (await loadStateMeta<PipelineHeartbeats>(SCOPE)) ?? {}
}

/**
 * Record the outcome of one pipeline run. Never throws — a heartbeat write
 * failure must not take the pipeline down with it.
 */
export async function recordPipelineRun(
  name: string,
  ok: boolean,
  detail: string,
): Promise<void> {
  try {
    const current = await readPipelineHeartbeats()
    await saveStateMeta(SCOPE, {
      ...current,
      [name]: { at: Date.now(), ok, detail: detail.slice(0, 200) },
    })
  } catch (err) {
    console.error(
      `[pipeline-heartbeat] write failed for ${name}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/**
 * Evaluate the expected pipelines against their heartbeats.
 *
 * A pipeline that has NEVER reported is reported separately from one that
 * stopped: the first means "not instrumented yet" (no alert — that would be
 * noise on every run during rollout), the second means "it ran and then went
 * quiet" (an alert, because a dead cron looks exactly like a healthy one).
 *
 * Pure — takes the heartbeat map so it can be tested without I/O.
 */
export function evaluatePipelines(
  heartbeats: PipelineHeartbeats,
  expectations: PipelineExpectation[] = EXPECTED_PIPELINES,
  nowMs: number = Date.now(),
): {
  failures: Array<{ name: string; detail: string }>
  healthy: string[]
  uninstrumented: string[]
} {
  const failures: Array<{ name: string; detail: string }> = []
  const healthy: string[] = []
  const uninstrumented: string[] = []

  for (const exp of expectations) {
    const hb = heartbeats[exp.name]
    if (!hb) {
      uninstrumented.push(exp.name)
      continue
    }
    const ageMs = nowMs - hb.at
    if (ageMs > exp.maxAgeMs) {
      failures.push({
        name: `pipeline ${exp.name}`,
        detail: `stopped — last run ${Math.round(ageMs / 60_000)}min ago (${hb.detail})`,
      })
      continue
    }
    if (!hb.ok) {
      failures.push({ name: `pipeline ${exp.name}`, detail: `last run failed: ${hb.detail}` })
      continue
    }
    healthy.push(`${exp.name} ${Math.round(ageMs / 60_000)}min`)
  }

  return { failures, healthy, uninstrumented }
}
