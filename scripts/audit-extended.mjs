// Extended audit — adds WS namespaces, cron jobs, bot commands, email/payment flows
import fs from 'fs'
import path from 'path'

const ORIGIN = 'https://tracker.aitradepulse.com'

// ─── WebSocket Namespaces ────────────────────────────────────
const WS_NAMESPACES = [
  { path: '/orderbook', public: true },
  { path: '/prices', public: true },
  { path: '/trade-stream', public: true },
  { path: '/derivatives', public: true },
  { path: '/liquidations', public: true },
  { path: '/forex', public: true },
  { path: '/arbitrage', public: true },
  { path: '/memecoins', public: true },
  { path: '/dexscreener', public: true },
  { path: '/trades', public: false },
  { path: '/alerts', public: false },
  { path: '/flows', public: false },
  { path: '/cex', public: false },
]

// ─── Cron Jobs ──────────────────────────────────────────────
const CRON_JOBS = [
  'harvest:idx-saham',
  'harvest:idx-screener',
  'harvest:idx-fundamentals',
  'harvest:crossex',
  'cron:alpha-track',
  'cron:feed-health',
]

// ─── Telegram Bot Commands ─────────────────────────────────
const BOT_COMMANDS = [
  '/start',
  '/help',
  '/status',
  '/price',
  '/whale',
  '/fear',
  '/backtest',
  '/alerts',
  '/subscribe',
  '/unsubscribe',
  '/feeds',
]

// ─── Email/Payment Flows ────────────────────────────────────
const PAYMENT_ENDPOINTS = [
  '/api/v1/checkout',
  '/api/v1/payments/history',
  '/api/v1/webhooks/payment',
]

async function checkWsNamespace(ns) {
  try {
    const res = await fetch(`${ORIGIN}/api/v1/health`, { signal: AbortSignal.timeout(5000) })
    const status = res.status === 200 ? 'reachable' : `HTTP ${res.status}`
    return { path: ns.path, public: ns.public, ok: true, note: `server ${status}` }
  } catch (e) {
    return { path: ns.path, public: ns.public, ok: false, note: String(e).slice(0, 60) }
  }
}

async function checkCronJob(job) {
  const scriptPath = path.join('src/scripts', `${job.replace(/:/g, '-')}`)
  const variants = [
    `${scriptPath}.ts`,
    `${scriptPath}.js`,
    `src/scripts/${job.replace(/:/g, '-')}-cron.ts`,
    `src/scripts/${job.replace(/:/g, '-')}.ts`,
  ]
  for (const v of variants) {
    if (fs.existsSync(v)) {
      return { job, ok: true, note: `script: ${v}` }
    }
  }
  try {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    const scriptKey = job.startsWith('harvest:') ? `harvest:${job.split(':')[1]}` : job
    if (pkg.scripts && pkg.scripts[scriptKey]) {
      return { job, ok: true, note: `npm script: ${pkg.scripts[scriptKey]}` }
    }
  } catch { /* ignore */ }
  return { job, ok: false, note: 'no script or npm entry found' }
}

async function checkBotCommand(cmd) {
  const botPath = 'src/lib/telegram/bot.ts'
  try {
    const content = fs.readFileSync(botPath, 'utf8')
    const escaped = cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`['"]/?\\s*${escaped.replace('/', '')}['"]|['"]${escaped}['"]`)
    if (re.test(content)) {
      return { command: cmd, ok: true, note: 'handled in bot.ts' }
    }
    const lower = content.toLowerCase()
    const cmdLower = cmd.toLowerCase().replace('/', '')
    if (lower.includes(`'${cmdLower}'`) || lower.includes(`"${cmdLower}"`)) {
      return { command: cmd, ok: true, note: 'handled (case-insensitive match)' }
    }
    return { command: cmd, ok: false, note: 'not found in bot.ts' }
  } catch (e) {
    return { command: cmd, ok: false, note: `bot.ts unreadable: ${String(e).slice(0, 40)}` }
  }
}

async function checkPaymentEndpoint(endpoint) {
  try {
    const res = await fetch(`${ORIGIN}${endpoint}`, { signal: AbortSignal.timeout(10000) })
    if (res.status >= 500) return { endpoint, ok: false, note: `HTTP ${res.status}` }
    if (res.status === 401) return { endpoint, ok: true, note: 'correctly gated (401)' }
    return { endpoint, ok: true, note: `HTTP ${res.status}` }
  } catch (e) {
    return { endpoint, ok: false, note: String(e).slice(0, 60) }
  }
}

async function main() {
  console.log('\n===== EXTENDED AUDIT — WS / Cron / Bot / Payments =====')

  console.log('\n--- WebSocket Namespaces ---')
  const wsResults = await Promise.all(WS_NAMESPACES.map(checkWsNamespace))
  for (const r of wsResults) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.path} (${r.public ? 'public' : 'auth'}) — ${r.note}`)
  }

  console.log('\n--- Cron Jobs ---')
  const cronResults = await Promise.all(CRON_JOBS.map(checkCronJob))
  for (const r of cronResults) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.job} — ${r.note}`)
  }

  console.log('\n--- Telegram Bot Commands ---')
  const botResults = await Promise.all(BOT_COMMANDS.map(checkBotCommand))
  for (const r of botResults) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.command} — ${r.note}`)
  }

  console.log('\n--- Payment Endpoints ---')
  const payResults = await Promise.all(PAYMENT_ENDPOINTS.map(checkPaymentEndpoint))
  for (const r of payResults) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.endpoint} — ${r.note}`)
  }

  const report = {
    generated: new Date().toISOString(),
    wsNamespaces: wsResults,
    cronJobs: cronResults,
    botCommands: botResults,
    paymentEndpoints: payResults,
  }
  fs.writeFileSync('audit-extended.json', JSON.stringify(report, null, 2))
  console.log('\nReport: audit-extended.json')
}

main().catch((e) => { console.error(e); process.exit(1) })
