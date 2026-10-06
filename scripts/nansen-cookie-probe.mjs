#!/usr/bin/env node
// scripts/nansen-cookie-probe.mjs
// DEFINITIVE live probe: does a real browser privy-token cookie auth api.nansen.ai?
// Run only when operator stages the cookie. Never prints full token values.
// Uses node:https only (Cloudflare fingerprints undici/fetch) — no new deps.
import { readFileSync } from 'node:fs';
import https from 'node:https';

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const REFERER = 'https://app.nansen.ai/';
const HOST = 'api.nansen.ai';
const PATH = '/api/v1/token-screener';
const TIMEOUT_MS = 15000;
const BODY = JSON.stringify({
  chains: ['ethereum'],
  timeframe: '24h',
  filters: { trader_type: 'sm' },
  pagination: { page: 1, per_page: 2 },
});

const trunc = (s) => String(s ?? '').slice(0, 12);

function usage(exitCode, extra = '') {
  const parts = [
    'Usage: node scripts/nansen-cookie-probe.mjs (--cookie-file <path> | --token <jwt>)',
    '',
    '  --cookie-file <path>  browser JSON cookie-array export containing nansen.ai cookies',
    '  --token <jwt>         privy-token JWT value directly',
    '',
    'What to export from the browser:',
    '  1. Log in at https://app.nansen.ai/ in Chrome.',
    '  2. Export cookies for nansen.ai (DevTools > Application > Cookies, or a cookie-export extension as JSON array).',
    '  3. Must include the `privy-token` cookie for domains .nansen.ai / nansen.ai / app.nansen.ai.',
  ];
  if (extra) parts.push('', extra);
  console.error(parts.join('\n'));
  process.exit(exitCode);
}

function parseArgs(argv) {
  let cookieFile = null;
  let token = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--cookie-file') cookieFile = argv[++i];
    else if (argv[i] === '--token') token = argv[++i];
    else if (argv[i] === '-h' || argv[i] === '--help') usage(2);
    else usage(2, 'Unknown arg: ' + argv[i]);
  }
  return { cookieFile, token };
}

function extractTokenFromCookieFile(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    console.error('Cannot read cookie file: ' + path + ' (' + (e.code || e.message) + ')');
    process.exit(2);
  }
  let arr;
  try {
    arr = JSON.parse(raw);
  } catch (_e) {
    console.error('Cookie file is not valid JSON: ' + path);
    process.exit(2);
  }
  if (!Array.isArray(arr)) {
    console.error('Cookie file must be a JSON array of cookies: ' + path);
    process.exit(2);
  }
  const inScope = arr.filter((c) => c && ['.nansen.ai', 'nansen.ai', 'app.nansen.ai'].includes(c.domain));
  const pool = inScope.length ? inScope : arr.filter((c) => c && /nansen/i.test(c.domain || ''));
  const names = pool.map((c) => c.name).filter(Boolean);
  const hit = pool.find((c) => c.name === 'privy-token');
  if (hit && hit.value) return { token: hit.value, source: 'privy-token from ' + path };
  const hint = names.length
    ? 'Found nansen cookie names (names only): ' + names.join(', ') + ' — none is privy-token.'
    : 'No nansen.ai cookies found in file at all.';
  usage(2, hint + '\nRe-export cookies while logged in at https://app.nansen.ai/ (need privy-token).');
}

// __dbg carries the token for truncated logging only; stripped before sending.
function requestOnce(headers, dbg) {
  const send = { ...headers };
  delete send.__dbg;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: HOST,
        path: PATH,
        method: 'POST',
        headers: {
          'User-Agent': UA,
          Referer: REFERER,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(BODY),
          ...send,
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => {
          if (data.length < 4096) data += c;
        });
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout after 15s')));
    req.on('error', reject);
    req.write(BODY);
    req.end();
  });
}

function verdict(status, body) {
  if (status === 200 && body && !/^<(!doctype|html)/i.test(body.trim())) return 'VIABLE';
  if (status === 401) return 'needs DPoP key';
  if (status === 402) return 'x402 paywall';
  return 'other (verbatim status ' + status + ')';
}

async function probe(label, headers, dbg) {
  let r;
  try {
    r = await requestOnce(headers, dbg);
  } catch (e) {
    console.log('[' + label + '] network error: ' + e.message);
    return { label, status: 'ERR', snippet: e.message.slice(0, 200), verdict: 'other (' + e.message + ')' };
  }
  if (r.status === 429 || (r.status >= 500 && r.status < 600)) {
    console.log('[' + label + '] got ' + r.status + ' — retrying once after 3s…');
    await new Promise((res) => setTimeout(res, 3000));
    try {
      r = await requestOnce(headers, dbg);
      console.log('[' + label + '] retry status: ' + r.status);
    } catch (e) {
      console.log('[' + label + '] retry network error: ' + e.message);
      return { label, status: 'ERR', snippet: e.message.slice(0, 200), verdict: 'other (' + e.message + ')' };
    }
  }
  const snippet = r.body.slice(0, 200);
  const v = verdict(r.status, r.body);
  console.log('[' + label + '] status=' + r.status + ' token~' + trunc(dbg));
  console.log('[' + label + '] body[:200]= ' + snippet);
  console.log('[' + label + '] verdict: ' + v);
  return { label, status: r.status, snippet, verdict: v };
}

const parsed = parseArgs(process.argv.slice(2));
if (!parsed.cookieFile && !parsed.token) {
  usage(2, 'No credential given: pass --cookie-file <path> or --token <jwt>.');
}

let token;
let source;
if (parsed.token) {
  token = parsed.token;
  source = 'CLI --token';
} else {
  const ex = extractTokenFromCookieFile(parsed.cookieFile);
  token = ex.token;
  source = ex.source;
}
console.log('Token source: ' + source + ' (token~' + trunc(token) + '…)');

const results = [];
results.push(await probe('cookie', { Cookie: 'privy-token=' + token }, token));
results.push(await probe('bearer', { Authorization: 'Bearer ' + token }, token));
results.push(await probe('noauth-baseline', {}, null));

console.log('');
console.log('Summary:');
console.log('mode             | status | verdict');
console.log('-----------------+--------+------------------');
for (const r of results) {
  console.log(r.label.padEnd(16) + ' | ' + String(r.status).padEnd(6) + ' | ' + r.verdict);
}
process.exit(0);
