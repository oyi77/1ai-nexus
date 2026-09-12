// Headless browser sweep across page routes.
//
// Reports only defects a user would notice: 5xx responses, unhandled
// exceptions, failed navigations, and pages that render almost nothing.
//
// Noise that is deliberately ignored:
//   - Next.js RSC prefetch aborts (`?_rsc=` fired on hover/visibility).
//   - 401s from endpoints that are user-scoped by design, plus the generic
//     "Failed to load resource ... 401" console echo that accompanies them.
//   - A first-attempt 5xx is retried once, because these routes degrade to 502
//     when an upstream is slow and that is not a page defect.
//
// Usage: node scripts/qa-browser-sweep.cjs [path ...]
import { chromium } from 'playwright';

const ORIGIN = 'https://tracker.aitradepulse.com';
const SETTLE_MS = 3500;
const THIN_BODY_CHARS = 400;

const DEFAULT_PAGES = [
  '/', '/dashboard', '/saham-ideas', '/intelligence', '/screener', '/meme',
  '/trending', '/portfolio', '/alerts', '/watchlist', '/copy-trading',
  '/predictions', '/fundamentals', '/financials', '/heatmap', '/etf',
  '/comps', '/ai-insights', '/ai-signals', '/options', '/sectors', '/market',
];

// Endpoints whose 401 is correct for an anonymous visitor.
const EXPECTED_401 = [
  '/api/v1/watchlist',
  '/api/v1/signals/history',
  '/api/v1/alerts',
  '/api/v1/account/',
  '/api/v1/modules/fetch',
];

const isExpected401 = (line) =>
  line.startsWith('HTTP 401') && EXPECTED_401.some((p) => line.includes(p));

const isGeneric401Echo = (line) => line.startsWith('CONSOLE') && /status of 401/.test(line);

const isPrefetchAbort = (line) => line.startsWith('REQFAIL') && line.includes('_rsc=');

const isServerError = (line) => /^HTTP 5\d\d /.test(line);

function reduce(raw) {
  const sawExpected401 = raw.some(isExpected401);
  return [...new Set(raw)]
    .filter((l) => !isPrefetchAbort(l) && !isExpected401(l))
    .filter((l) => !(isGeneric401Echo(l) && sawExpected401))
    .map((l) => l.replace(/[0-9a-f]{12,}/g, 'HASH'));
}

(async () => {
  const pages = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_PAGES;
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  let bucket = [];
  page.on('console', (m) => {
    if (m.type() === 'error') bucket.push('CONSOLE ' + m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => bucket.push('PAGEERROR ' + String(e.message).slice(0, 200)));
  page.on('requestfailed', (r) => {
    const err = r.failure()?.errorText || '';
    if (err.includes('ERR_ABORTED')) return;
    bucket.push(`REQFAIL ${err}: ${r.url().replace(ORIGIN, '').slice(0, 120)}`);
  });
  page.on('response', (r) => {
    const u = r.url();
    if (!u.startsWith(ORIGIN)) return;
    const path = u.replace(ORIGIN, '').split('?')[0].slice(0, 120);
    if (r.status() >= 500) bucket.push(`HTTP ${r.status()} ${path}`);
    if (r.status() === 401) bucket.push(`HTTP 401 ${path}`);
  });

  async function visit(path) {
    bucket = [];
    let textLen = 0;
    let note = '';
    try {
      await page.goto(ORIGIN + path, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(SETTLE_MS);
      textLen = (await page.evaluate(() => document.body.innerText || '')).length;
      const title = await page.title();
      if (/404|error/i.test(title)) note = `title=${title}`;
    } catch (e) {
      note = 'NAV ' + String(e.message).slice(0, 140);
    }
    return { textLen, note, raw: [...bucket] };
  }

  const report = [];
  for (const p of pages) {
    let { textLen, note, raw } = await visit(p);

    // Upstream slowness surfaces as a transient 502; confirm before reporting.
    if (raw.some(isServerError)) {
      await page.waitForTimeout(2500);
      ({ textLen, note, raw } = await visit(p));
    }

    const issues = reduce(raw);
    if (note) issues.unshift(note);
    if (textLen < THIN_BODY_CHARS) issues.unshift(`THIN BODY (${textLen} chars)`);
    report.push({ path: p, textLen, issues });
  }

  await browser.close();

  const broken = report.filter((r) => r.issues.length);
  console.log(`swept ${report.length} pages — ${broken.length} with defects\n`);
  for (const r of broken) {
    console.log(`${r.path}  (${r.textLen} chars)`);
    for (const i of r.issues) console.log('    ' + i);
  }
  if (!broken.length) console.log('no defects found');
})();
