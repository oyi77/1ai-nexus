import { chromium } from 'playwright'

const BASE = 'http://localhost:4400'
const paths = ['/', '/copy-trading/performance']

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

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => {
    pageErrors.push(err.message || String(err))
  })

  let httpStatus = '?'
  try {
    const resp = await page.goto(BASE + p, { waitUntil: 'domcontentloaded', timeout: 30000 })
    httpStatus = resp ? resp.status() : 'no-resp'
  } catch (e) {
    httpStatus = 'goto-error: ' + (e.message || String(e))
  }
  await page.waitForTimeout(5000)

  const ok = httpStatus === 200 && consoleErrors.length === 0 && pageErrors.length === 0

  console.log(`\n===== ${p} =====`)
  console.log('HTTP status    :', httpStatus)
  console.log('console errors :', consoleErrors.length)
  consoleErrors.slice(0, 5).forEach((e) => console.log('   •', e.slice(0, 200)))
  console.log('page errors    :', pageErrors.length)
  pageErrors.slice(0, 5).forEach((e) => console.log('   •', e.slice(0, 200)))
  console.log('VERDICT        :', ok ? 'PASS' : 'FAIL')
  if (!ok) overallOk = false

  await page.close()
}

await browser.close()
console.log('\n========== OVERALL: ' + (overallOk ? 'PASS' : 'FAIL') + ' ==========')
process.exit(overallOk ? 0 : 1)
