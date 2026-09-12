// API route-handler sweep.
//
// Enumerates every static `route.ts` under src/app and probes it, so a route
// that regressed to 500 / 404 / an error envelope shows up without clicking
// through the UI. Payload shape is inspected too, because several routes answer
// 200 with `{ error }` or a null `data` and a status-only check would miss it.
//
//   node scripts/apisweep.mjs            # local next-server on :4400
//   node scripts/apisweep.mjs --live     # https://tracker.aitradepulse.com
//
// A route that is user-scoped by design answers 401 to an anonymous caller;
// that is reported as AUTH, not a defect.
import { readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';

const LIVE = process.argv.includes('--live');
const BASE = LIVE ? 'https://tracker.aitradepulse.com' : 'http://127.0.0.1:4400';

function apiKey() {
  if (process.env.NEXUS_API_KEYS) return process.env.NEXUS_API_KEYS.split(',')[0].trim();
  try {
    const line = readFileSync('.env', 'utf8')
      .split('\n')
      .find((l) => l.startsWith('NEXUS_API_KEYS'));
    return (line?.split('=')[1] ?? '').replace(/["']/g, '').split(',')[0].trim();
  } catch {
    return '';
  }
}

const KEY = apiKey();
const HEADERS = KEY ? { 'X-API-Key': KEY, Accept: 'application/json' } : { Accept: 'application/json' };

const routes = [];
function isRouteGroup(seg) {
  return seg.startsWith('(') && seg.endsWith(')');
}
function walk(dir, segs) {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, [...segs, e]);
    else if (e === 'route.ts' || e === 'route.tsx') {
      const routeSegs = segs.filter((s) => !isRouteGroup(s));
      routes.push({
        route: '/' + routeSegs.join('/'),
        dynamic: segs.some((s) => s.startsWith('[')),
      });
    }
  }
}
walk('src/app', []);
const targets = routes.filter((r) => !r.dynamic).sort((a, b) => a.route.localeCompare(b.route));

const CONCURRENCY = 20;
const TIMEOUT_MS = 15_000;

async function probe(route) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + route, { headers: HEADERS, redirect: 'manual', signal: ctrl.signal });
    const text = await res.text();
    let note = '';
    if (res.ok) {
      try {
        const j = JSON.parse(text);
        if (j && typeof j === 'object' && !Array.isArray(j)) {
          if (j.error) note = 'error-envelope: ' + String(j.error).slice(0, 70);
          else if ('data' in j && j.data == null) note = 'data:null';
          else if ('data' in j && Array.isArray(j.data) && j.data.length === 0) note = 'data:[]';
        }
      } catch {
        note = 'non-json:' + text.slice(0, 40).replace(/\s+/g, ' ');
      }
    }
    return { route, code: res.status, bytes: text.length, note };
  } catch (e) {
    return { route, code: 'ERR', bytes: 0, note: e.name === 'AbortError' ? 'timeout' : String(e).slice(0, 50) };
  } finally {
    clearTimeout(t);
  }
}

const results = [];
for (let i = 0; i < targets.length; i += CONCURRENCY) {
  const batch = targets.slice(i, i + CONCURRENCY);
  const out = await Promise.all(batch.map((r) => probe(r.route)));
  results.push(...out);
  process.stderr.write(`  probed ${Math.min(i + CONCURRENCY, targets.length)}/${targets.length}\r`);
}

const bucket = (r) =>
  r.code === 'ERR' ? 'ERR'
  : r.code === 401 || r.code === 403 ? 'AUTH'
  : r.code >= 500 ? 'SERVER'
  : r.code >= 400 ? 'CLIENT'
  : 'OK';

const groups = {};
for (const r of results) (groups[bucket(r)] ??= []).push(r);

console.log(`\n=== ${LIVE ? 'LIVE ' + BASE : BASE} — ${targets.length} static API handlers ===`);
for (const [k, v] of Object.entries(groups).sort()) console.log(`  ${k.padEnd(7)} ${v.length}`);
if (!KEY) console.log('  (no API key found — protected routes will read AUTH)');

const failures = [...(groups.SERVER ?? []), ...(groups.ERR ?? []), ...(groups.CLIENT ?? [])];
console.log(`\n--- FAILURES (${failures.length}) ---`);
if (!failures.length) console.log('  NONE');
for (const r of failures) console.log(`  ${String(r.code).padEnd(4)} ${r.route}  ${r.note}`);

const suspicious = (groups.OK ?? []).filter((r) => r.note);
console.log(`\n--- 200s WORTH A LOOK (${suspicious.length}) ---`);
if (!suspicious.length) console.log('  NONE');
for (const r of suspicious) console.log(`  ${r.route}  ${r.note}`);
