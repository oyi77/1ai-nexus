// ─────────────────────────────────────────────────────────────
// Solana wallet harvest — read-only, paper/shadow mode.
// Source: public RPC https://api.mainnet-beta.solana.com (keyless).
// Proven live: getSignaturesForAddress, getTransaction(jsonParsed,
// maxSupportedTransactionVersion:1), getTokenAccountsByOwner, Jupiter
// lite-api.jup.ag/price/v3 (current price only).
//
// NOT sources: blockscout-eth / covalent (EVM-only, cannot reconstruct
// Solana wallets), Solscan v2 (Cloudflare 403 all modes), public-api
// .birdeye.so (401 without key). HELIUS/ALCHEMY/BIRDEYE/SOLSCAN_API_KEY
// are UNSET — never claimed available.
//
// Limits (measured): burst ~50 sequential getTransaction → 429.
// This module throttles (~1.5rps default), backs off on 429, paginates
// with before/until cursors, and reports coverage gaps. No USD history
// is invented: Jupiter gives CURRENT price only; historical legs without
// USD are flagged missing-usd and blocked from classification.
// ─────────────────────────────────────────────────────────────

export const SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';
// The single public endpoint answers 429 within seconds of any real burst
// (measured 2026-10-11: every harvestWallet call, even limit=10, died on
// "RPC 429" after ~23s of retries). Failover keeps the harvest alive; order
// is by measured reliability, and SOLANA_RPC_URLS overrides it.
export const SOLANA_RPC_URLS: string[] = (
  // Order = measured completeness, not throughput. 2026-10-11 probes:
  // mainnet-beta serves every method but 429s under burst; publicnode
  // serves getSignaturesForAddress only — it answers -32602 "Request
  // blocked" for getTokenAccountsByOwner and -32015 for some v0
  // transactions, so it must be the FALLBACK, never the primary.
  process.env.SOLANA_RPC_URLS ??
  'https://api.mainnet-beta.solana.com,https://solana-rpc.publicnode.com'
)
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);
export const JUP_PRICE_URL = 'https://lite-api.jup.ag/price/v3';
export const SOL_MINT = 'So11111111111111111111111111111111111111112';
const LAMPORTS_PER_SOL = 1_000_000_000;

// ─── NormalizedSwap (backward-compatible extension) ────────────
// Old SwapEvent {tokenIn,tokenOut,amountIn,amountOut,priceIn,priceOut,
// timestamp} keeps working. NormalizedSwap adds provenance + fee +
// completeness so the classifier never scores invented USD.
export interface NormalizedSwap {
  chain: 'solana';
  walletAddress: string;
  transactionSignature: string;
  timestamp: number | null;
  inputMint: string;
  outputMint: string;
  inputAmount: number;
  outputAmount: number;
  inputUsd: number | null;
  outputUsd: number | null;
  feeNative: number | null; // SOL
  feeUsd: number | null;
  feeKnown: boolean;
  source: string;
  completeness: 'complete' | 'partial' | 'rejected';
  rejectReason?: string;
  limitations: string[];
}

export interface HarvestCoverage {
  wallet: string;
  fromTs: number | null;
  toTs: number | null;
  sigsSeen: number;
  txFetched: number;
  validEvents: number;
  rejectedEvents: number;
  gaps: string[];
  sources: string[];
  complete30d: boolean;
}

export interface RpcSig {
  signature: string;
  blockTime: number | null;
  err: unknown;
  slot: number;
}

// Injectable fetch for tests (defaults to global fetch).
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
let fetchFn: FetchFn | null = null;
export function __setHarvestFetchForTests(fn: FetchFn | null): void {
  fetchFn = fn;
}
function http(): FetchFn {
  if (fetchFn) return fetchFn;
  return (u, i) => fetch(u, i);
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}
async function rpcCall<T>(method: string, params: unknown[], opts: { timeoutMs?: number; retries?: number } = {}): Promise<T> {
  const f = http()
  const retries = opts.retries ?? 5
  const endpoints = SOLANA_RPC_URLS
  let delay = 800
  let lastErr: unknown = null
  // Rotate endpoints on each attempt: a 429 on one host says nothing about
  // the next, and the old single-endpoint loop burned all 5 retries against
  // the same throttled host.
  for (let attempt = 0; attempt <= retries; attempt++) {
    const url = endpoints[attempt % endpoints.length]
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000)
    try {
      const res = await f(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'nexus/1.0' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: ctrl.signal,
      })
      clearTimeout(t)
      if (res.status === 429) throw new Error('RPC 429')
      if (!res.ok) throw new Error(`RPC ${res.status}`)
      const json = (await res.json()) as { result?: T; error?: unknown }
      if (json.error) throw new Error(`RPC error: ${JSON.stringify(json.error).slice(0, 160)}`)
      return json.result as T
    } catch (e) {
      clearTimeout(t)
      lastErr = e
      if (attempt >= retries) throw e
      await sleep(delay + Math.random() * 400)
      delay = Math.min(delay * 2, 8_000)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/** Page signatures newest→oldest with `before` cursor. Stops at `until` sig or limit. */
export async function fetchSignatures(
  wallet: string,
  opts: { limit?: number; before?: string; until?: string; pageSize?: number; throttleMs?: number } = {},
): Promise<{ sigs: RpcSig[]; truncated: boolean }> {
  const pageSize = Math.min(opts.pageSize ?? 100, 1000);
  const hardLimit = opts.limit ?? 1000;
  const out: RpcSig[] = [];
  let before = opts.before;
  let truncated = false;
  for (;;) {
    const params: Record<string, unknown> = { limit: pageSize };
    if (before) params.before = before;
    if (opts.until) params.until = opts.until;
    const page = await rpcCall<RpcSig[]>('getSignaturesForAddress', [wallet, params]);
    if (!page || page.length === 0) break;
    for (const s of page) {
      out.push(s);
      if (out.length >= hardLimit) {
        truncated = true;
        return { sigs: out, truncated };
      }
    }
    if (page.length < pageSize) break;
    before = page[page.length - 1].signature;
    await sleep(opts.throttleMs ?? 650); // ~1.5rps: stays under the measured 429 burst
  }
  return { sigs: out, truncated };
}

interface TokenBal {
  accountIndex: number;
  mint: string;
  owner: string;
  uiTokenAmount: { uiAmount: number | null; amount: string; decimals: number };
}

// ─── Parser (pure, fixture-testable) ───────────────────────────
// Primary signal: pre/post tokenBalance DELTAS for owner==wallet.
// Corroboration: innerInstructions spl-token transfers (not required).
// One signature → at most ONE NormalizedSwap (largest outflow→largest
// inflow) to prevent double-counting multi-leg txs. Fee (meta.fee) is
// attributed once, never per leg.
export function parseSolanaTransaction(
  wallet: string,
  signature: string,
  tx: {
    blockTime: number | null;
    meta: {
      err: unknown;
      fee?: number;
      preBalances?: number[];
      postBalances?: number[];
      preTokenBalances?: TokenBal[];
      postTokenBalances?: TokenBal[];
    } | null;
    transaction?: { message?: { accountKeys?: Array<string | { pubkey: string }> } };
  },
): NormalizedSwap[] {
  const base = {
    chain: 'solana' as const,
    walletAddress: wallet,
    transactionSignature: signature,
    source: 'solana-rpc:mainnet-beta',
    limitations: [] as string[],
  };
  const meta = tx.meta;
  if (!meta) {
    return [{ ...base, timestamp: tx.blockTime != null ? tx.blockTime * 1000 : null, inputMint: '', outputMint: '', inputAmount: 0, outputAmount: 0, inputUsd: null, outputUsd: null, feeNative: null, feeUsd: null, feeKnown: false, completeness: 'rejected', rejectReason: 'missing-meta', limitations: ['missing-meta'] }];
  }
  if (meta.err !== null && meta.err !== undefined) {
    return [{ ...base, timestamp: tx.blockTime != null ? tx.blockTime * 1000 : null, inputMint: '', outputMint: '', inputAmount: 0, outputAmount: 0, inputUsd: null, outputUsd: null, feeNative: null, feeUsd: null, feeKnown: false, completeness: 'rejected', rejectReason: 'tx-err', limitations: [] }];
  }
  const ts = tx.blockTime != null ? tx.blockTime * 1000 : null;
  const feeNative = typeof meta.fee === 'number' ? meta.fee / LAMPORTS_PER_SOL : null;

  // Group token balances by mint for owner==wallet.
  const pre = new Map<string, number>();
  const post = new Map<string, number>();
  for (const b of meta.preTokenBalances ?? []) {
    if (b.owner !== wallet) continue;
    pre.set(b.mint, (pre.get(b.mint) ?? 0) + (b.uiTokenAmount.uiAmount ?? 0));
  }
  for (const b of meta.postTokenBalances ?? []) {
    if (b.owner !== wallet) continue;
    post.set(b.mint, (post.get(b.mint) ?? 0) + (b.uiTokenAmount.uiAmount ?? 0));
  }
  const mints = new Set([...pre.keys(), ...post.keys()]);
  const inflows: Array<{ mint: string; amt: number }> = [];
  const outflows: Array<{ mint: string; amt: number }> = [];
  for (const m of mints) {
    const d = (post.get(m) ?? 0) - (pre.get(m) ?? 0);
    if (d > 0) inflows.push({ mint: m, amt: d });
    else if (d < 0) outflows.push({ mint: m, amt: -d });
  }

  // SOL leg: wallet balance delta minus fee.
  let solSpent = 0;
  let solReceived = 0;
  try {
    const keys = tx.transaction?.message?.accountKeys ?? [];
    const idx = keys.findIndex((k) => (typeof k === 'string' ? k : k.pubkey) === wallet);
    if (idx >= 0 && meta.preBalances && meta.postBalances && meta.preBalances.length > idx) {
      const diff = (meta.preBalances[idx] ?? 0) - (meta.postBalances[idx] ?? 0);
      const net = diff - (meta.fee ?? 0);
      if (net > 0) solSpent = net / LAMPORTS_PER_SOL;
      else if (net < 0) solReceived = -net / LAMPORTS_PER_SOL;
    }
  } catch { /* SOL leg optional */ }

  if (solSpent > 0) outflows.push({ mint: SOL_MINT, amt: solSpent });
  if (solReceived > 0) inflows.push({ mint: SOL_MINT, amt: solReceived });

  const limitations: string[] = [];
  if (ts === null) limitations.push('missing-blockTime');
  if (inflows.length === 0 || outflows.length === 0) {
    // Transfer/airdrop/LP/migration without a paired side — NOT a swap.
    return [{ ...base, timestamp: ts, inputMint: '', outputMint: '', inputAmount: 0, outputAmount: 0, inputUsd: null, outputUsd: null, feeNative, feeUsd: null, feeKnown: feeNative !== null, completeness: 'rejected', rejectReason: 'non-swap-no-pair', limitations }];
  }
  if (inflows.length > 1 || outflows.length > 1) limitations.push('multi-leg-tx-single-event');
  limitations.push('missing-usd'); // historical USD never invented; priced downstream or blocked

  inflows.sort((a, b) => b.amt - a.amt);
  outflows.sort((a, b) => b.amt - a.amt);
  return [{
    ...base,
    timestamp: ts,
    inputMint: outflows[0].mint,
    outputMint: inflows[0].mint,
    inputAmount: outflows[0].amt,
    outputAmount: inflows[0].amt,
    inputUsd: null,
    outputUsd: null,
    feeNative,
    feeUsd: null,
    feeKnown: feeNative !== null,
    completeness: 'partial',
    limitations,
  }];
}

/** Current-price USD fill (Jupiter v3). Marks stalePrice — never historical. */
export async function fillCurrentUsd(swaps: NormalizedSwap[]): Promise<void> {
  const f = http();
  const mints = [...new Set(swaps.flatMap((s) => [s.inputMint, s.outputMint]))]
    .filter((m) => m && m !== SOL_MINT)
    .slice(0, 50);
  const prices = new Map<string, number>();
  if (mints.length > 0) {
    try {
      // Jupiter hangs long enough to eat a whole cron tick when it is slow;
      // a missing price is already handled (usd stays null), so bound it.
      const res = await f(`${JUP_PRICE_URL}?ids=${mints.join(',')}`, {
        headers: { 'User-Agent': 'nexus/1.0' },
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) {
        const j = (await res.json()) as Record<string, { usdPrice?: number }>;
        for (const m of mints) if (typeof j[m]?.usdPrice === 'number') prices.set(m, j[m].usdPrice as number);
      }
    } catch { /* prices stay missing */ }
  }
  // SOL price for fee conversion
  let solUsd: number | null = null;
  try {
    const res = await f(`${JUP_PRICE_URL}?ids=${SOL_MINT}`, {
      headers: { 'User-Agent': 'nexus/1.0' },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) {
      const j = (await res.json()) as Record<string, { usdPrice?: number }>;
      if (typeof j[SOL_MINT]?.usdPrice === 'number') solUsd = j[SOL_MINT].usdPrice as number;
    }
  } catch { /* ignore */ }
  for (const s of swaps) {
    if (s.completeness === 'rejected') continue;
    const pi = prices.get(s.inputMint);
    const po = prices.get(s.outputMint);
    // SOL legs: leave null unless SOL price known (still stale, flagged)
    if (pi !== undefined) s.inputUsd = pi * s.inputAmount;
    if (po !== undefined) s.outputUsd = po * s.outputAmount;
    if (s.feeNative !== null && solUsd !== null) s.feeUsd = s.feeNative * solUsd;
    if (!s.limitations.includes('stalePrice-current-only')) s.limitations.push('stalePrice-current-only');
    if (!s.limitations.includes('current-price-not-historical')) s.limitations.push('current-price-not-historical');
    // NEVER promote partial→complete from current Jupiter price: current ≠ historical.
  }
}

/** Validate one event. Pure. */
export function validateSwap(s: NormalizedSwap, seen: Set<string>): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const key = `${s.transactionSignature}:${s.inputMint}>${s.outputMint}`;
  if (seen.has(key)) reasons.push('dup-signature');
  if (s.completeness === 'rejected') reasons.push(s.rejectReason ?? 'rejected');
  if (s.timestamp === null || !Number.isFinite(s.timestamp) || s.timestamp <= 0) reasons.push('bad-timestamp');
  if (!s.inputMint || !s.outputMint) reasons.push('missing-mint');
  if (!(s.inputAmount > 0) || !(s.outputAmount > 0)) reasons.push('nonpositive-amount');
  if (s.inputMint === s.outputMint) reasons.push('same-mint');
  // missing-fee is NOT a reject: classifier uses fee=0 + confidence downgrade via feeKnown=false.
  return { ok: reasons.length === 0, reasons };
}

/** Full read-only harvest: sigs → tx → parse → validate → coverage. No DB writes. */
export async function harvestWallet(
  wallet: string,
  opts: { limit?: number; days?: number; withUsd?: boolean; throttleMs?: number } = {},
): Promise<{ swaps: NormalizedSwap[]; coverage: HarvestCoverage }> {
  const days = opts.days ?? 30;
  const cutoff = Date.now() - days * 86_400_000;
  const { sigs, truncated } = await fetchSignatures(wallet, { limit: opts.limit ?? 1000, throttleMs: opts.throttleMs });
  const gaps: string[] = [];
  if (truncated) gaps.push('pagination-truncated-limit-reached');
  const swaps: NormalizedSwap[] = [];
  const seen = new Set<string>();
  let valid = 0;
  let rejected = 0;
  let txOk = 0;
  let fromTs: number | null = null;
  let toTs: number | null = null;
  let prevTs: number | null = null;
  for (const sig of sigs) {
    if (sig.blockTime !== null && sig.blockTime * 1000 < cutoff) continue; // 30d window
    let txJson: { result: { blockTime: number | null; meta: { err: unknown; fee?: number; preBalances?: number[]; postBalances?: number[]; preTokenBalances?: TokenBal[]; postTokenBalances?: TokenBal[] } | null; transaction?: { message?: { accountKeys?: Array<string | { pubkey: string }> } } } | null };
    try {
      // v0-era and v1 transactions both exist on-chain today: the public
      // RPC gate rejects version mismatch explicitly, so ask for v1 and
      // let legacy nodes cap down. Measured 2026-10-11: v0 demand fails
      // on publicnode for v1 txs; v1 demand succeeds there.
      txJson = await rpcCall('getTransaction', [sig.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 }]);
    } catch (e) {
      gaps.push(`fetch-fail:${sig.signature.slice(0, 8)}:${e instanceof Error ? e.message.slice(0, 40) : 'err'}`);
      continue;
    }
    txOk++;
    let res = txJson.result;
    if (!res) {
      // Pruned-history failover: some free endpoints keep signatures but
      // drop old transaction bodies (result null, no error). Retry the
      // same call against the NEXT configured endpoint before giving up.
      for (const url of SOLANA_RPC_URLS.slice(1)) {
        try {
          const r2 = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [sig.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 }] }),
            signal: AbortSignal.timeout(30_000),
          });
          const j2 = (await r2.json()) as typeof txJson;
          if (j2.result) { res = j2.result; gaps.push(`tx-failover:${sig.signature.slice(0, 8)}`); break; }
        } catch { /* next endpoint */ }
      }
    }
    if (!res) {
      gaps.push(`tx-null:${sig.signature.slice(0, 8)}`);
      continue;
    }
    const events = parseSolanaTransaction(wallet, sig.signature, res);
    for (const ev of events) {
      const v = validateSwap(ev, seen);
      seen.add(ev.transactionSignature + ':' + ev.inputMint + '>' + ev.outputMint);
      if (v.ok && ev.timestamp !== null) {
        fromTs = fromTs === null ? ev.timestamp : Math.min(fromTs, ev.timestamp);
        toTs = toTs === null ? ev.timestamp : Math.max(toTs, ev.timestamp);
      }
      if (ev.timestamp !== null) {
        if (prevTs !== null && ev.timestamp > prevTs) gaps.push('out-of-order-event');
        prevTs = ev.timestamp;
      }
      if (!v.ok) {
        rejected++;
        if (ev.completeness !== 'rejected') {
          ev.completeness = 'rejected';
          ev.rejectReason = v.reasons.join(',');
        }
      } else valid++;
      swaps.push(ev);
    }
    await sleep(opts.throttleMs ?? 650);
  }
  if (opts.withUsd) await fillCurrentUsd(swaps);
  const complete30d = !truncated && gaps.filter((g) => g.startsWith('fetch-fail') || g.startsWith('tx-null')).length === 0;
  return {
    swaps,
    coverage: {
      wallet, fromTs, toTs, sigsSeen: sigs.length, txFetched: txOk,
      validEvents: valid, rejectedEvents: rejected, gaps,
      sources: ['solana-rpc:mainnet-beta'],
      complete30d,
    },
  };
}
