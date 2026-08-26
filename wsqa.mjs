import { chromium } from 'playwright'

const BASE = 'https://tracker.aitradepulse.com'
const paths = ['/scanner', '/ai-signals']

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})

let overallOk = true

for (const p of paths) {
  const page = await browser.newPage()
  const consoleErrors = []
  const pageErrors = []
  const blockedLocal = []
  const wsTargets = new Set()
  const reqFailed = []

  page.on('console', (msg) => {
    const t = msg.text()
    if (msg.type() === 'error') consoleErrors.push(t)
    if (t.includes('ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS')) blockedLocal.push(t)
  })
  page.on('pageerror', (err) => {
    const t = err.message || String(err)
    pageErrors.push(t)
    if (t.includes('ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS')) blockedLocal.push(t)
  })
  page.on('websocket', (ws) => {
    wsTargets.add(ws.url())
    if (ws.url().includes('ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS')) blockedLocal.push(ws.url())
  })
  page.on('request', (req) => {
    const u = req.url()
    if (u.includes('tracker-ws.aitradepulse.com') || u.includes('localhost:4401') || u.includes(':4401')) {
      wsTargets.add(u)
    }
  })
  page.on('requestfailed', (req) => {
    const u = req.url()
    const err = req.failure()?.errorText || ''
    if (u.includes('tracker-ws.aitradepulse.com') || u.includes('localhost:4401') || u.includes(':4401')) {
      reqFailed.push(`${u} :: ${err}`)
    }
    if (err.includes('ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS')) blockedLocal.push(`${u} :: ${err}`)
  })

  let httpStatus = '?'
  try {
    const resp = await page.goto(BASE + p, { waitUntil: 'networkidle', timeout: 30000 })
    httpStatus = resp ? resp.status() : 'no-resp'
  } catch (e) {
    httpStatus = 'goto-error: ' + (e.message || String(e))
  }
  // give Socket.IO time to attempt connect + reconnect
  await page.waitForTimeout(7000)

  const sawTrackerWs = [...wsTargets].some((u) => u.includes('tracker-ws.aitradepulse.com'))
  const sawLocalhost = [...wsTargets].some((u) => u.includes('localhost:4401'))
  const ok = blockedLocal.length === 0 && httpStatus === 200 && sawTrackerWs && !sawLocalhost

  console.log(`\n===== ${p} =====`)
  console.log('HTTP status        :', httpStatus)
  console.log('WS targets seen    :', [...wsTargets].slice(0, 8))
  console.log('  -> tracker-ws    :', sawTrackerWs)
  console.log('  -> localhost:4401:', sawLocalhost)
  console.log('console errors     :', consoleErrors.length)
  consoleErrors.slice(0, 5).forEach((e) => console.log('   •', e.slice(0, 200)))
  console.log('page errors        :', pageErrors.length)
  pageErrors.slice(0, 5).forEach((e) => console.log('   •', e.slice(0, 200)))
  console.log('reqFailed (ws)     :', reqFailed.length)
  reqFailed.slice(0, 5).forEach((e) => console.log('   •', e.slice(0, 200)))
  console.log('BLOCKED_LOCAL_NET  :', blockedLocal.length)
  blockedLocal.slice(0, 5).forEach((e) => console.log('   •', e.slice(0, 200)))
  console.log('VERDICT            :', ok ? 'PASS' : 'FAIL')
  if (!ok) overallOk = false

  await page.close()
}

await browser.close()
console.log('\n========== OVERALL: ' + (overallOk ? 'PASS' : 'FAIL') + ' ==========')
process.exit(overallOk ? 0 : 1)
