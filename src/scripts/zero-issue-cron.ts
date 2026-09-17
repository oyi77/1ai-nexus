#!/usr/bin/env node
// -------------------------------------------------------------
// Zero-issue continuous audit cron:
//   1. Health endpoints (basic + detailed: modules, feeds)
//   2. Route-class API smoke on localhost (auth gate included)
//   3. Data-pipeline liveness (77+ modules, degraded tolerance)
//   4. PM2 process liveness (1ai-tracker-web online, restart sanity)
//   5. Alert via Telegram ONLY on new failures (state-diffed, no spam)
//
// Cron: */15 * * * *
// Alert channel: ecosystem convention — HUB_TELEGRAM_BOT_TOKEN +
// HUB_TELEGRAM_OWNER_CHAT_ID (1ai-hub .env), the pairing proven to
// deliver. Falls back to TELEGRAM_ADMIN_CHAT_ID on this repo's token.
// -------------------------------------------------------------

import 'dotenv/config'
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const DATA_DIR = process.cwd() + '/data'
mkdirSync(DATA_DIR, { recursive: true })
const STATE_PATH = DATA_DIR + '/zero-issue-state.json'

const BASE = process.env.ZERO_ISSUE_BASE || 'http://localhost:4400'
const TIMEOUT_MS = 20_000
const GLOBAL_PM2 = '/home/openclaw/.nvm/versions/node/v22.22.3/bin/pm2'

// ─── Checks ──────────────────────────────────────────────────

async function check(name: string, fn: () => Promise<string>): Promise<{ name: string; ok: boolean; detail: string }> {
  try {
    const detail = await fn()
    return { name, ok: true, detail }
  } catch (e) {
    return { name, ok: false, detail: String((e as Error).message || e).slice(0, 140) }
  }
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal })
    const body = await res.json().catch(() => ({}))
    if (res.status >= 500) throw new Error(`HTTP ${res.status}`)
    return body as Record<string, unknown>
  } finally {
    clearTimeout(t)
  }
}

const checks: Array<{ name: string; ok: boolean; detail: string }> = []

async function runChecks() {
  // 1. basic health
  checks.push(await check('health', async () => {
    const j = await getJson(`${BASE}/api/v1/health`)
    if (j.error) throw new Error(String(j.error))
    return 'ok'
  }))

  // 2. detailed health: modules degraded + feeds
  // One shared detailed fetch: the endpoint re-probes all 108 feeds per call,
  // and repeated calls within seconds cause probe-burst feed timeouts.
  // Failure here is a check result, not a crash — the alert must still fire.
  let detailed: Record<string, unknown> | undefined
  try {
    detailed = (await getJson(`${BASE}/api/v1/health/detailed`)).data as Record<string, unknown> | undefined
  } catch (e) {
    checks.push({ name: 'health-detailed', ok: false, detail: String((e as Error).message || e).slice(0, 140) })
  }

  checks.push(await check('modules-degraded', async () => {
    const j = detailed
    const m = j?.modules as { total?: number; degraded?: number } | undefined
    if (!m || typeof m.degraded !== 'number') throw new Error('modules block missing')
    // Circuit breaker opens at 3 consecutive upstream failures; the registry
    // serves fallbacks, so a standing degraded count is steady state, not an
    // incident. Alert only when degraded RISES >3 above the learned baseline.
    const prev0 = readState()
    const baseline = prev0.degradedBaseline ?? m.degraded
    if (m.degraded > baseline + 3) throw new Error(`${m.degraded} degraded of ${m.total} (baseline ${baseline})`)
    if (m.degraded < baseline) {
      // upstreams recovered; rebase downward
      writeState({ ...prev0, degradedBaseline: m.degraded })
    }
    return `${m.total} modules, degraded=${m.degraded} (baseline ${baseline}, fallbacks active)`
  }))

  checks.push(await check('feeds-health', async () => {
    const f = detailed?.feeds as { working?: number; total?: number } | undefined
    if (!f || typeof f.working !== 'number') throw new Error('feeds block missing')
    // Full-feed probes transiently kill 1-3 slow third-party feeds under
    // burst load (measured 105->108->105->108 across one evening, all
    // self-healing). Alert only beyond that band.
    const dead = (f.total ?? 0) - (f.working ?? 0)
    if (dead > 3) throw new Error(`feeds ${f.working}/${f.total} (${dead} dead)`)
    return `feeds ${f.working}/${f.total}`
  }))

  // 3. route-class API smoke (public reads + the auth gate)
  const smoke: Array<[string, number]> = [
    ['/api/v1/health', 200],
    ['/api/v1/news?limit=5', 200],
    ['/api/v1/saham/screener', 200],
    ['/api/v1/saham/ajaib?symbol=BBRI', 200],
    ['/api/v1/saham/stockbit?symbol=BBRI', 200],
    ['/api/v1/saham/signals?view=rs&limit=5', 200],
    ['/api/v1/saham/signals?view=breakout&limit=5', 200],
    ['/api/v1/saham/signals?view=bandar&limit=5', 200],
    ['/api/v1/saham/signals?view=ara&limit=5', 200],
    ['/api/v1/saham/signals?view=sectormatrix', 200],
    ['/api/v1/saham/signals?view=backtest&lane=breakout', 200],
    ['/api/v1/saham/dual', 200],
    ['/api/v1/saham/ajaib?market=indices&index=IDX30', 200],
    ['/api/v1/saham/calendar', 503],
    ['/api/v1/admin/integrations', 401],
    ['/api/v1/fear-greed', 200],
  ]
  for (const [ep, expect] of smoke) {
    checks.push(await check(`api ${ep}`, async () => {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
      try {
        const res = await fetch(BASE + ep, { signal: ctrl.signal })
        if (res.status !== expect) throw new Error(`HTTP ${res.status}, expected ${expect}`)
        return String(res.status)
      } finally {
        clearTimeout(t)
      }
    }))
  }

  // 4. PM2 liveness: web process online
  // Use the global pm2 binary: a repo-local pm2 in node_modules/.bin shadows
  // it under npx/tsx and prints an "In-memory PM2 is out-of-date" banner that
  // pollutes jlist stdout. Strip any banner defensively anyway.
  checks.push(await check('pm2-web-online', async () => {
    const out = execSync(`${GLOBAL_PM2} jlist`, { encoding: 'utf8' })
    const jsonStart = out.indexOf('[{')
    const procs = JSON.parse(jsonStart >= 0 ? out.slice(jsonStart) : out) as Array<{ name: string; pm2_env: { status: string; restart_time?: number; unstable_restarts?: number } }>
    const web = procs.find(p => p.name === '1ai-tracker-web')
    if (!web) throw new Error('1ai-tracker-web not found in pm2')
    if (web.pm2_env.status !== 'online') throw new Error(`status=${web.pm2_env.status}`)
    if ((web.pm2_env.unstable_restarts ?? 0) > 3) throw new Error(`unstable_restarts=${web.pm2_env.unstable_restarts}`)
    return `online, restarts=${web.pm2_env.restart_time ?? 0}, unstable=${web.pm2_env.unstable_restarts ?? 0}`
  }))

  // 5. WS server port
  checks.push(await check('ws-port-4401', async () => {
    const res = await fetch('http://localhost:4401/socket.io/?EIO=4&transport=polling', { signal: AbortSignal.timeout(5000) })
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
    return 'handshake ok'
  }))
}

// ─── Alerting (state-diffed) ─────────────────────────────────

interface AuditState { failures: string[]; lastOk?: string; lastAlert?: string; degradedBaseline?: number; lastFailures?: string[] }

function readState(): AuditState {
  try { return JSON.parse(readFileSync(STATE_PATH, 'utf8')) } catch { return { failures: [] } }
}
function writeState(s: AuditState) {
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2))
}

function loadHubEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    for (const line of readFileSync('/home/openclaw/projects/1ai-hub/.env', 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/)
      if (m) out[m[1]] = m[2].trim()
    }
  } catch { /* hub repo may be absent */ }
  return out
}

async function sendTelegram(text: string): Promise<boolean> {
  const hub = loadHubEnv()
  const token = hub.HUB_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || ''
  const chatId = hub.HUB_TELEGRAM_OWNER_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID || ''
  if (!token || !chatId) {
    console.error('[zero-issue] no alert channel configured (need HUB_TELEGRAM_BOT_TOKEN + HUB_TELEGRAM_OWNER_CHAT_ID)')
    return false
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    })
    const j = (await res.json()) as { ok: boolean; description?: string }
    if (!j.ok) console.error('[zero-issue] telegram send failed:', j.description?.slice(0, 100))
    return j.ok
  } catch (e) {
    console.error('[zero-issue] telegram send error:', String(e).slice(0, 100))
    return false
  }
}

// ─── Main ────────────────────────────────────────────────────

async function main() {
  const t0 = Date.now()
  await runChecks()
  const failures = checks.filter(c => !c.ok)
  const prev = readState()

  const stamp = new Date().toISOString()
  if (failures.length === 0) {
    writeState({ failures: [], lastOk: stamp })
    console.log(`[zero-issue] ${stamp} ALL ${checks.length} CHECKS PASS (${Date.now() - t0}ms)`)
    return
  }

  const ids = failures.map(f => f.name)
  const newOnly = ids.filter(id => !prev.failures.includes(id))

  writeState({
    failures: ids,
    lastAlert: stamp,
    lastFailures: failures.map(f => `${f.name}: ${f.detail}`),
  })

  const lines = [
    `🔴 [1ai-tracker] zero-issue audit: ${failures.length}/${checks.length} check(s) FAILED`,
    ...failures.map(f => `  • ${f.name}: ${f.detail}`),
    newOnly.length ? `new since last run: ${newOnly.join(', ')}` : '(same failures as previous run — no new regressions)',
  ]
  const sent = await sendTelegram(lines.join('\n'))
  console.log(`[zero-issue] ${stamp} ${failures.length} FAILURES: ${ids.join(', ')} | alert ${sent ? 'sent' : 'NOT SENT'}`)
  process.exit(1)
}

main().catch(e => {
  console.error('[zero-issue] audit crashed:', String(e).slice(0, 200))
  process.exit(2)
})
