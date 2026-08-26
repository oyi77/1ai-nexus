import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const appDir = 'src/app';
const pages = [];

function isRouteGroup(seg) {
  return seg.startsWith('(') && seg.endsWith(')');
}

function walk(dir, segs) {
  const entries = readdirSync(dir);
  for (const e of entries) {
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, [...segs, e]);
    } else if (e === 'page.tsx' || e === 'page.ts') {
      const routeSegs = segs.filter((s) => !isRouteGroup(s));
      const route = '/' + routeSegs.join('/');
      const dynamic = segs.some((s) => s.startsWith('['));
      pages.push({ route: route === '/' ? '/' : route, dynamic });
    }
  }
}

walk(appDir, []);

const staticPages = pages.filter((p) => !p.dynamic);
const dynamicPages = pages.filter((p) => p.dynamic);

console.log(`Static pages : ${staticPages.length}`);
console.log(`Dynamic pages: ${dynamicPages.length}`);

const results = [];
for (const p of staticPages) {
  const url = 'http://localhost:4400' + p.route;
  try {
    const code = execSync(
      `curl -s -o /dev/null -w "%{http_code}" --max-time 15 "${url}"`,
      { encoding: 'utf8' }
    ).trim();
    results.push({ route: p.route, code });
  } catch {
    results.push({ route: p.route, code: 'ERR' });
  }
}

// Also probe a couple of always-public API endpoints
const apiProbes = ['/api/v1/status', '/status'];
for (const a of apiProbes) {
  const url = 'http://localhost:4400' + a;
  const code = execSync(
    `curl -s -o /dev/null -w "%{http_code}" --max-time 15 "${url}"`,
    { encoding: 'utf8' }
  ).trim();
  results.push({ route: a, code, isApi: true });
}

const non200 = results.filter((r) => r.code !== '200');
console.log(`\nStatic+API probed: ${results.length}`);
console.log(`200 OK            : ${results.filter((r) => r.code === '200').length}`);
console.log(`NON-200           : ${non200.length}`);
for (const r of non200) console.log(`  ${r.code}  ${r.route}`);
