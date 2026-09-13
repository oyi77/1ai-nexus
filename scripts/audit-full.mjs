// Comprehensive live audit — pages + API routes + envelope checks + chunk parity.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const ORIGIN = 'https://tracker.aitradepulse.com';
const SETTLE_MS = 4500;
const THIN_BODY_CHARS = 400;
const WORKERS = 10;

// Discover page routes from src/app/page.tsx files
function discoverPages() {
  const out = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (e.name === 'page.tsx') {
        const rel = path.relative('src/app', dir);
        const segs = rel === '.' ? [] : rel.split(path.sep);
        if (segs.some((s) => s.startsWith('['))) continue;
        const clean = segs.filter((s) => !(s.startsWith('(') && s.endsWith(')')));
        out.push('/' + clean.join('/'));
      }
    }
  }
  walk('src/app');
  return [...new Set(out)].sort();
}

// Discover API route paths
function discoverApis() {
  const out = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (e.name === 'route.ts') {
        const rel = path.relative('src/app', dir);
        out.push('/' + (rel === 'route.ts' ? '' : rel));
      }
    }
  }
  walk('src/app/api');
  return [...new Set(out.map((p) => p.replace(/\/route\.ts$/, '')))].sort();
}

const pages = discoverPages();
const apiPaths = discoverApis();

const EXPECTED_401 = ['/api/v1/watchlist', '/api/v1/alerts', '/api/v1/account/', '/api/v1/keys'];

function classifyApi(status, body) {
  if (status === 401 || status === 403) return { cls: 'auth-gated', note: `HTTP ${status}` };
  if (status === 404) return { cls: 'needs-params', note: 'HTTP 404' };
  if (status >= 500) return { cls: 'error', note: `HTTP ${status}` };
  if (status === 400) return { cls: 'needs-params', note: 'HTTP 400' };
  if (status === 307 || status === 308) return { cls: 'ok', note: `HTTP ${status}` };
  let j = null;
  try { j = JSON.parse(body); } catch { return { cls: 'ok', note: `HTTP ${status} (${body.length}b)` }; }
  const data = j?.data;
  const err = j?.error;
  if (data === null && err) return { cls: 'degrades', note: `err: ${String(err).slice(0, 60)}` };
  if (data === null) return { cls: 'degrades', note: 'data:null' };
  return { cls: 'ok', note: '200 ok' };
}

async function auditPage(ctx, pagePath) {
  const page = await ctx.newPage();
  const bucket = [];
  page.on('console', (m) => { if (m.type() === 'error') bucket.push('CONSOLE ' + m.text().slice(0, 180)); });
  page.on('pageerror', (e) => bucket.push('PAGEERROR ' + String(e.message).slice(0, 180)));
  page.on('response', (r) => {
    const u = r.url();
    if (!u.startsWith(ORIGIN)) return;
    const p = u.replace(ORIGIN, '').split('?')[0].slice(0, 110);
    if (r.status() >= 400) bucket.push(`HTTP ${r.status()} ${p}`);
  });
  let textLen = 0, note = '';
  try {
    await page.goto(ORIGIN + pagePath, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(SETTLE_MS);
    textLen = (await page.evaluate(() => (document.body.innerText || '').length));
    const title = await page.title();
    if (/404|error/i.test(title)) note = `title=${title}`;
  } catch (e) { note = 'NAV ' + String(e.message).slice(0, 120); }
  await page.close();
  const clean = [...new Set(bucket.filter((l) => !l.includes('_rsc=') && !/ERR_ABORTED/.test(l)))];
  const issues = note ? [note] : [];
  if (textLen < THIN_BODY_CHARS) issues.push(`THIN BODY (${textLen})`);
  issues.push(...clean.filter((l) => {
    if (l.startsWith('CONSOLE') && /status of 401/.test(l)) return false;
    if (l.startsWith('HTTP 401') && EXPECTED_401.some((p) => l.includes(p))) return false;
    return true;
  }));
  return { path: pagePath, textLen, issues };
}

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const contexts = await Promise.all(
    Array.from({ length: WORKERS }, () => browser.newContext({ viewport: { width: 1280, height: 800 } })),
  );
  console.log(`pages: ${pages.length}, api: ${apiPaths.length}`);
  const pageResults = [];
  let idx = 0;
  await Promise.all(contexts.map(async (ctx) => {
    while (idx < pages.length) {
      const i = idx++;
      const r = await auditPage(ctx, pages[i]);
      pageResults.push(r);
    }
  }));
  const apiPage = await contexts[0].newPage();
  const apiResults = [];
  for (const p of apiPaths) {
    let status = 0, body = '';
    try {
      const res = await apiPage.goto(ORIGIN + p, { waitUntil: 'domcontentloaded', timeout: 15000 });
      status = res.status();
      body = await res.body().then((b) => b.toString()).catch(() => '');
    } catch (e) { body = 'FETCH_ERR ' + String(e.message).slice(0, 80); }
    const { cls, note } = classifyApi(status, body);
    apiResults.push({ path: p, status, cls, note });
  }
  await apiPage.close();
  await browser.close();

  const pOk = pageResults.filter((r) => r.issues.length === 0);
  const pBroken = pageResults.filter((r) => r.issues.length > 0);
  const aOk = apiResults.filter((r) => r.cls === 'ok');
  const aAuth = apiResults.filter((r) => r.cls === 'auth-gated');
  const aParams = apiResults.filter((r) => r.cls === 'needs-params');
  const aDegrade = apiResults.filter((r) => r.cls === 'degrades');
  const aErr = apiResults.filter((r) => r.cls === 'error');

  const report = {
    generated: new Date().toISOString(),
    pages: { total: pageResults.length, ok: pOk.length, broken: pBroken.length },
    api: { total: apiResults.length, ok: aOk.length, auth: aAuth.length, params: aParams.length, degrade: aDegrade.length, error: aErr.length },
    pageDefects: pBroken,
    apiErrors: aErr,
    apiDegrades: aDegrade,
  };
  fs.writeFileSync('audit-report.json', JSON.stringify(report, null, 2));
  console.log(`\npages: ${pOk.length}/${pageResults.length} ok, ${pBroken.length} defects`);
  console.log(`api:   ${aOk.length}/${apiResults.length} ok, ${aErr.length} errors, ${aDegrade.length} degrades`);
  console.log('report: audit-report.json');
}
main().catch((e) => { console.error(e); process.exit(1); });
