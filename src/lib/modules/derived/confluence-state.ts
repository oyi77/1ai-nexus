// ─────────────────────────────────────────────────────────────
// Smart-money confluence alert — seen state + pure render/decision helpers.
//
// Keeps `lastSentAtMs` per token mint so the same confluence signal cannot
// fire twice inside the cooldown window. The file is runtime state
// (gitignored), regenerated on demand — the same discipline as
// data/accumulation-alert-state.json.
//
// Rules (mirror accumulation-state.ts):
//   - missing/corrupt file reads as empty, never throws
//   - entries older than 7d are pruned on read AND write so the file
//     never grows without bound
//   - markSent is pure (returns the next state); callers persist it
//   - the alert renderer is pure: one compact HTML message per signal,
//     mint + window + per-wallet lines + `alert ≠ entry` footer, capped
//     well under Telegram's 4096-char limit
// ─────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  CONFLUENCE_DEFAULTS,
  type ConfluenceSignal,
} from './smart-money-confluence';
import { escapeHtml } from './meme-sniper';
import {
  isConfluenceSeen as isConfluenceSeenDb,
  markConfluenceSeen as markConfluenceSeenDb,
} from './db-seen-store';
export { isConfluenceSeenDb as isConfluenceSeen, markConfluenceSeenDb as markConfluenceSeen };

export type ConfluenceSeenState = Record<string, number>;

const STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ConfluenceWalletRow {
  address: string;
  status: string;
  alias: string | null;
}

function statePath(): string {
  return (
    process.env.CONFLUENCE_SEEN_PATH ??
    join(process.cwd(), 'data', 'confluence-seen.json')
  );
}

export function emptyConfluenceSeenState(): ConfluenceSeenState {
  return {};
}

/**
 * Drop entries whose lastSentAtMs is older than `ttlMs`. Pure — returns a
 * new object so a caller can prune without touching the file.
 */
export function pruneConfluenceSeenState(
  state: ConfluenceSeenState,
  nowMs: number = Date.now(),
  ttlMs: number = STATE_TTL_MS,
): ConfluenceSeenState {
  const out: ConfluenceSeenState = {};
  for (const [mint, at] of Object.entries(state)) {
    if (typeof at === 'number' && Number.isFinite(at) && nowMs - at <= ttlMs) {
      out[mint] = at;
    }
  }
  return out;
}

/** Read the state; a missing/corrupt file reads as empty (never throws). */
export function readConfluenceSeenState(): ConfluenceSeenState {
  const path = statePath();
  if (!existsSync(path)) return emptyConfluenceSeenState();
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return emptyConfluenceSeenState();
    }
    const state: ConfluenceSeenState = {};
    for (const [mint, at] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof at === 'number' && Number.isFinite(at)) state[mint] = at;
    }
    return pruneConfluenceSeenState(state);
  } catch {
    return emptyConfluenceSeenState();
  }
}

/** Record a sent alert for a mint. Pure — returns the next state. */
export function markConfluenceSent(
  state: ConfluenceSeenState,
  mint: string,
  atMs: number = Date.now(),
): ConfluenceSeenState {
  return { ...state, [mint]: atMs };
}

/**
 * Persist the JSON state as before (pruned, directory created). Callers
 * must ALSO call `markConfluenceSeen` per sent mint for the DB primary.
 */
export function writeConfluenceSeenState(
  state: ConfluenceSeenState,
): ConfluenceSeenState {
  const next = pruneConfluenceSeenState(state);
  const path = statePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2));
  return next;
}

/**
 * Pure dedupe + cooldown gate: a signal is sent when the mint was never
 * sent before, or the last send is at least `cooldownMs` ago (the exact
 * cooldown boundary is allowed, matching accumulation-alert's shouldSend).
 */
export function shouldSendConfluence(
  signal: Pick<ConfluenceSignal, 'tokenMint'>,
  state: ConfluenceSeenState,
  nowMs: number,
  cooldownMs: number = 6 * 60 * 60 * 1000,
): boolean {
  const last = state[signal.tokenMint];
  if (typeof last !== 'number' || !Number.isFinite(last)) return true;
  return nowMs - last >= cooldownMs;
}

function fmtWindow(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60 > 0 ? ` ${m % 60}m` : ''}`;
}

function fmtUsd(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`;
  return `$${usd.toFixed(2)}`;
}

/**
 * Render ONE compact HTML alert for a confluence signal. Pure. Structure:
 * header · token/mint (tap-to-copy) · `<n> qualified wallets</n> bought
 * within <window>` · per-wallet lines (alias/status) · evidence ·
 * `⚠️ alert ≠ entry` footer. Telegram HTML discipline: only `&<>` escaped,
 * dynamic text never contains them after escapeHtml.
 */
export function renderConfluenceAlert(
  signal: ConfluenceSignal,
  wallets: ConfluenceWalletRow[],
): string {
  const byAddress = new Map(wallets.map((w) => [w.address, w]));
  const windowMs = signal.windowEnd - signal.windowStart;
  const lines: string[] = [
    '🧠 <b>SMART MONEY CONFLUENCE</b>',
    '',
    `🪙 <b>Mint:</b> <code>${escapeHtml(signal.tokenMint)}</code> <i>(tap to copy)</i>`,
    `<b>${signal.qualifiedBuyers.length} qualified wallets</b> bought within ${fmtWindow(windowMs)}`,
    `💰 <b>Qualified buy inflow:</b> <b>${fmtUsd(signal.totalBuyUsd)}</b>`,
    `🕐 <b>First → last buy:</b> ${new Date(signal.firstBuyAt).toISOString()} → ${new Date(signal.lastBuyAt).toISOString()}`,
    '',
  ];
  for (const address of signal.qualifiedBuyers) {
    const w = byAddress.get(address);
    const name =
      w?.alias && w.alias.trim() !== ''
        ? escapeHtml(w.alias.trim())
        : `${escapeHtml(address.slice(0, 6))}…${escapeHtml(address.slice(-4))}`;
    const status = escapeHtml(w?.status || 'QUALIFIED');
    lines.push(`• <b>${name}</b> [${status}] — <code>${escapeHtml(address)}</code>`);
  }
  lines.push(
    '',
    `<i>${new Date(signal.windowEnd).toISOString()}</i>`,
    '⚠️ <i>Confluence is evidence, not execution — alert ≠ entry.</i>',
  );
  return lines.join('\n');
}

/** Alert never exceeds this — deliverSniperAlert truncates at 4096, we stay far below. */
export const CONFLUENCE_ALERT_MAX_CHARS = 2000;

/** True when the rendered alert fits the compact-alert budget. */
export function alertFitsBudget(text: string): boolean {
  return text.length <= CONFLUENCE_ALERT_MAX_CHARS;
}

/** Re-export so the cron passes detector defaults without another import. */
export { CONFLUENCE_DEFAULTS };
/**
 * Confluence artifact persistence & discovery contracts (Fase 4).
 * Mirror of wallet-buys-latest.json discipline:
 *   - missing/corrupt file reads as empty, never throws
 *   - signals older than maxAgeMin (default 120 min) are stale and dropped
 *   - formatted for sniper discovery hydration
 */
export interface ConfluenceArtifactSignal {
  contract: string;
  chain: string;
  buyers: string[];
  totalBuyUsd: number;
  firstBuyAt: number;
  lastBuyAt: number;
}

export interface ConfluenceArtifactFile {
  generated_at: string;
  window_min: number;
  signals: ConfluenceArtifactSignal[];
}

export function confluenceArtifactPath(): string {
  return (
    process.env.CONFLUENCE_LATEST_PATH ??
    join(process.cwd(), 'data', 'confluence-latest.json')
  );
}

export interface WriteConfluenceArtifactOptions {
  windowMin?: number;
  filePath?: string;
  generatedAt?: string;
}

/**
 * Write summary artifact data/confluence-latest.json for sniper scan discovery.
 * Pure formatted serialization + idempotent directory creation.
 */
export function writeConfluenceArtifact(
  signals: Array<ConfluenceSignal | ConfluenceArtifactSignal>,
  options?: WriteConfluenceArtifactOptions,
): ConfluenceArtifactFile {
  const p = options?.filePath ?? confluenceArtifactPath();
  const windowMin = options?.windowMin ?? 15;
  const generatedAt = options?.generatedAt ?? new Date().toISOString();

  const formattedSignals: ConfluenceArtifactSignal[] = signals.map((s) => {
    const contract = 'tokenMint' in s ? s.tokenMint : s.contract;
    const buyers = 'qualifiedBuyers' in s ? s.qualifiedBuyers : s.buyers;
    const chain = 'chain' in s && s.chain ? s.chain : 'solana';
    return {
      contract,
      chain,
      buyers: Array.isArray(buyers) ? buyers : [],
      totalBuyUsd: typeof s.totalBuyUsd === 'number' ? s.totalBuyUsd : 0,
      firstBuyAt: typeof s.firstBuyAt === 'number' ? s.firstBuyAt : 0,
      lastBuyAt: typeof s.lastBuyAt === 'number' ? s.lastBuyAt : 0,
    };
  });

  const payload: ConfluenceArtifactFile = {
    generated_at: generatedAt,
    window_min: windowMin,
    signals: formattedSignals,
  };

  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

export interface ReadConfluenceArtifactOptions {
  filePath?: string;
  nowMs?: number;
  maxAgeMin?: number;
}

/**
 * Read confluence artifact for sniper scan discovery.
 * Missing, corrupted, or stale (>maxAgeMin) artifacts return empty array. Never throws.
 */
export async function readConfluenceArtifact(
  optionsOrPath?: string | ReadConfluenceArtifactOptions,
): Promise<ConfluenceArtifactSignal[]> {
  try {
    const p =
      typeof optionsOrPath === 'string'
        ? optionsOrPath
        : optionsOrPath?.filePath ?? confluenceArtifactPath();
    const nowMs =
      typeof optionsOrPath === 'object' && optionsOrPath?.nowMs !== undefined
        ? optionsOrPath.nowMs
        : Date.now();
    const maxAge =
      typeof optionsOrPath === 'object' && optionsOrPath?.maxAgeMin !== undefined
        ? optionsOrPath.maxAgeMin
        : Number(process.env.CONFLUENCE_MAX_AGE_MIN) || 120;

    const raw = JSON.parse(await readFile(p, 'utf8')) as ConfluenceArtifactFile;
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.signals)) {
      return [];
    }
    const ageMin = (nowMs - Date.parse(raw.generated_at)) / 60_000;
    if (!Number.isFinite(ageMin) || ageMin > maxAge || ageMin < -5) {
      return []; // stale or unparseable timestamp
    }
    return raw.signals.filter(
      (s): s is ConfluenceArtifactSignal =>
        Boolean(
          s &&
            typeof s === 'object' &&
            typeof s.contract === 'string' &&
            Array.isArray(s.buyers),
        ),
    );
  } catch {
    return []; // artifact missing/unparseable → no confluence candidates
  }
}
