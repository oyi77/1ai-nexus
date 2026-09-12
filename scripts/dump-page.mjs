// Dump what a page actually renders, plus its console/page/network errors.
//
// The sweep (`qa-browser-sweep.mjs`) only tells you *which* pages are broken;
// this tells you *why*. Point it at one URL and it prints the visible text and
// every error the page produced.
//
//   node scripts/dump-page.mjs https://tracker.aitradepulse.com/orderbook
//   node scripts/dump-page.mjs http://127.0.0.1:4400/prediction-markets 10000
import { chromium } from 'playwright';

const url = process.argv[2];
const settle = Number(process.argv[3] ?? 6000);

if (!url) {
  console.error('usage: node scripts/dump-page.mjs <url> [settleMs]');
  process.exit(1);
}

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
const failed = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.message).slice(0, 220)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('CONSOLE ' + m.text().slice(0, 220));
});
page.on('requestfailed', (r) => {
  if (r.url().includes('_rsc=')) return; // Next.js prefetch abort, not a defect
  failed.push('REQFAIL ' + r.url().slice(0, 110) + ' :: ' + (r.failure()?.errorText ?? ''));
});
page.on('response', (r) => {
  if (r.status() >= 400) failed.push(`HTTP ${r.status()} ${r.url().slice(0, 110)}`);
});

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForTimeout(settle);

const text = await page.evaluate(() => document.body.innerText || '');

console.log(`=== ${url}`);
console.log(`=== visible text: ${text.length} chars`);
console.log('----------------------------------------');
console.log(text.slice(0, 1500));
console.log('----------------------------------------');
console.log(`=== ERRORS (${errors.length})`);
for (const e of [...new Set(errors)].slice(0, 15)) console.log('  ', e);
console.log(`=== FAILED REQUESTS (${failed.length})`);
for (const f of [...new Set(failed)].slice(0, 15)) console.log('  ', f);

await browser.close();
