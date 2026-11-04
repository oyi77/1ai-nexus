import { chromium } from 'playwright'
import fs from 'node:fs'

const routes = [
  '/markets', '/screener', '/market', '/saham', '/saham?tab=ideas', '/saham/bandarmology', '/saham/ideas',
  '/equities', '/commodities', '/forex', '/bonds', '/derivatives', '/derivatives-intel', '/options',
  '/options-intel', '/etf', '/etf-flows', '/heatmap', '/trending', '/orderbook', '/charts', '/compare',
  '/compare/tokens', '/tokens', '/tokens/discover', '/fundamentals', '/financials', '/historical-financials',
  '/dcf', '/comps', '/insider', '/moonshot', '/macro-hub', '/macro', '/global-macro', '/indonesia-macro',
  '/news-feed', '/news-intel', '/feeds', '/correlations', '/correlation-matrix', '/calendar',
  '/cycle-indicators', '/weather', '/predictions', '/predictions?tab=markets', '/predictions?tab=paper',
  '/predictions?tab=tape', '/predictions?tab=board', '/alpha-engine', '/backtest', '/analytics', '/basis',
  '/liquidations', '/arbitrage', '/gaps', '/flows',
]

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] })
const results = []
let cursor = 0
async function worker() {
  const page = await browser.newPage()
  while (cursor < routes.length) {
    const route = routes[cursor++]
    const badResponses = []
    const consoleErrors = []
    const onResponse = res => {
      if (res.url().includes('/api/') && res.status() >= 400) badResponses.push({ url: res.url(), status: res.status() })
    }
    const onConsole = msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()) }
    page.on('response', onResponse)
    page.on('console', onConsole)
    try {
      const response = await page.goto(`http://127.0.0.1:4400${route}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await page.waitForTimeout(12000)
      const content = await page.evaluate(() => {
        const root = document.querySelector('main') || document.body
        const text = root.innerText || ''
        const emptyPatterns = /No data[^\n]*|No items[^\n]*|No signals[^\n]*|No candidates[^\n]*|Not available[^\n]*|Unavailable[^\n]*|Loading[^\n]*|Failed to load[^\n]*/ig
        return {
          text: text.slice(0, 1800).replace(/\s+/g, ' ').trim(),
          bodyLength: text.length,
          rows: root.querySelectorAll('tbody tr, [role="row"]').length,
          tables: root.querySelectorAll('table').length,
          numberMatches: (text.match(/[$€£Rp]?\s*-?\d+([.,]\d+)?%?/g) || []).length,
          nan: (text.match(/\bNaN\b/g) || []).length,
          undefined: (text.match(/\bundefined\b/g) || []).length,
          null: (text.match(/\bnull\b/g) || []).length,
          objectObject: (text.match(/\[object Object\]/g) || []).length,
          rawTemplate: (text.match(/\$\{.*?\}|\{\{.*?\}\}/g) || []).length,
          emptyIndicators: [...new Set(text.match(emptyPatterns) || [])].slice(0, 8),
        }
      })
      results.push({ route, status: response?.status() ?? null, ...content, badResponses, consoleErrors: [...new Set(consoleErrors)] })
    } catch (error) {
      results.push({ route, error: String(error), badResponses, consoleErrors: [...new Set(consoleErrors)] })
    }
    page.off('response', onResponse)
    page.off('console', onConsole)
  }
  await page.close()
}
await Promise.all(Array.from({ length: 5 }, worker))
results.sort((a, b) => routes.indexOf(a.route) - routes.indexOf(b.route))
fs.writeFileSync('/tmp/audit-content-final-a.json', JSON.stringify(results, null, 2))
await browser.close()
