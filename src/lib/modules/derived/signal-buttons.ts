// ─────────────────────────────────────────────────────────────
// Signal buttons — inline trade/chart keyboard for delivered signals.
// Carved from signal-tier.ts for the 800-line gate.
// ─────────────────────────────────────────────────────────────

export interface ContractButtons {
  inline_keyboard: Array<Array<{ text: string; url: string }>>
}

/** Base58 mint shape: Solana mints are 32–44 alphanumeric base58 chars. */
const BASE58_MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/** Chains this signal builder has real, provider-shaped link URLs for. */
const LINK_SUPPORTED_CHAINS: Record<string, true> = { solana: true }

export interface SignalLinkUrlValidation {
  /** Dexscreener chart URL (doubles as the chart link). Null when invalid. */
  chartUrl: string | null
  /**
   * Jupiter swap URL the builder actually emits. This repo SCREENS — it
   * never executes — so the Jupiter route is a link the operator can open,
   * never an order. Pump.fun mints route to the SOL-pair swap; everything
   * else routes to the generic USDC pair. Null only when validation fails.
   */
  swapUrl: string | null
  valid: boolean
  reason: string
}

/**
 * Validate the exact chart/swap URLs `contractButtons` would emit for a
 * mint. Pure — zero I/O. Deterministic: a valid non-pump Solana mint always
 * yields a chart URL and a Jupiter swap URL; a pump mint yields the SOL-pair
 * swap route. Both URLs carry the FULL validated mint (never a symbol).
 */
export function validateSignalLinkUrls(contract: string, chain?: string | null): SignalLinkUrlValidation {
  const supportedChain = LINK_SUPPORTED_CHAINS[chain ?? 'solana'] === true
  if (typeof contract !== 'string' || contract.length === 0) {
    return { chartUrl: null, swapUrl: null, valid: false, reason: 'contract is empty' }
  }
  if (!BASE58_MINT_RE.test(contract)) {
    return { chartUrl: null, swapUrl: null, valid: false, reason: 'contract is not a base58 mint' }
  }
  if (!supportedChain) {
    return { chartUrl: null, swapUrl: null, valid: false, reason: `unsupported chain: ${chain ?? 'null'}` }
  }
  const c = encodeURIComponent(contract)
  const chartUrl = `https://dexscreener.com/${chain ?? 'solana'}/${c}`
  const swapUrl = contract.endsWith('pump')
    ? `https://jup.ag/swap/SOL-${c}`
    : `https://jup.ag/swap/${c}-USDC`
  return { chartUrl, swapUrl, valid: true, reason: 'ok' }
}

/**
 * Inline trade buttons under a signal. Pure URL keyboard — Telegram renders
 * native tap buttons, no extra API surface.
 *
 * Bot targets:
 * - Row 1: Axiom, Jupiter (direct buy routes)
 * - Row 2: Dexscreener (chart), GMGN (screening)
 * - Row 3: Trojan (Solana TG bot), Phantom (deep-link via Jup)
 * - Row 4: Photon (terminal), BullX (terminal)
 * - Row 5: Maestro (multi-chain TG bot), Solscan (explorer)
 *
 * Note: Telegram bot deeplinks (Trojan, Maestro) rely on the target bot's
 * /start parser handling raw mints.
 */
export function contractButtons(contract: string, chain?: string | null): ContractButtons {
  const v = validateSignalLinkUrls(contract, chain)
  if (!v.valid) return { inline_keyboard: [] }
  const c = encodeURIComponent(contract)
  const isPump = contract.endsWith('pump')
  const swapUrl = isPump ? `https://jup.ag/swap/SOL-${c}` : `https://jup.ag/swap/${c}-USDC`
  return {
    inline_keyboard: [
      [
        { text: '🟢 BUY Axiom', url: `https://axiom.trade/t/${c}` },
        { text: '⚡ BUY Jupiter', url: swapUrl },
      ],
      [
        { text: '📊 Dexscreener', url: v.chartUrl ?? '' },
        { text: '🔍 GMGN', url: `https://gmgn.ai/sol/token/${c}` },
      ],
      [
        { text: '🐴 Trojan', url: `https://t.me/solana_trojanbot?start=${c}` },
        { text: '👻 Phantom', url: `https://phantom.app/ul/browse/https://jup.ag/swap/SOL-${c}` },
      ],
      [
        { text: '⚡ Photon', url: `https://photon-sol.tinyastro.io/en/lp/${c}` },
        { text: '🐂 BullX', url: `https://bullx.io/terminal?chainId=1399811149&address=${c}` },
      ],
      [
        { text: '🎩 Maestro', url: `https://t.me/maestro?start=${c}` },
        { text: '🔎 Solscan', url: `https://solscan.io/token/${c}` },
      ],
    ],
  }
}
