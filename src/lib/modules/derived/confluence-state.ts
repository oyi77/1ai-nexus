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
import { dirname, join } from 'node:path';
import {
  CONFLUENCE_DEFAULTS,
  type ConfluenceSignal,
} from './smart-money-confluence';
import { escapeHtml } from './meme-sniper';

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

/** Persist the state; prunes stale entries and creates the directory. */
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
