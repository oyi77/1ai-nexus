import { describe, expect, it } from 'vitest'
import {
  detectChainFromAddress,
  extractWhaleAlertLeads,
  WHALE_ALERT_LEAD_DEFAULT_MIN_USD,
} from './leads'
import type { WhaleAlertItem } from './fetcher'

const EVM_A = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e'
const EVM_B = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B'
const SOL_A = '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1'

function item(over: Partial<WhaleAlertItem> = {}): WhaleAlertItem {
  return {
    id: 'binance-unknown-100',
    amount: 100,
    symbol: 'BTC',
    usd: 6_000_000,
    from: 'Binance',
    to: 'Unknown Wallet',
    ...over,
  }
}

describe('detectChainFromAddress — address vs name discipline', () => {
  it('detects EVM 0x addresses as ethereum', () => {
    expect(detectChainFromAddress(EVM_A)).toBe('ethereum')
  })

  it('detects Solana base58 addresses as solana', () => {
    expect(detectChainFromAddress(SOL_A)).toBe('solana')
  })

  it('returns null for exchange names', () => {
    expect(detectChainFromAddress('Binance')).toBeNull()
    expect(detectChainFromAddress('Unknown Wallet')).toBeNull()
    expect(detectChainFromAddress('Coinbase Exchange')).toBeNull()
  })

  it('returns null for truncated addresses with ellipsis', () => {
    expect(detectChainFromAddress('0x742d…f44e')).toBeNull()
    expect(detectChainFromAddress('5Q54…pge4j1')).toBeNull()
  })

  it('returns null for empty / blank strings', () => {
    expect(detectChainFromAddress('')).toBeNull()
    expect(detectChainFromAddress('   ')).toBeNull()
  })

  it('trims whitespace before matching', () => {
    expect(detectChainFromAddress(`  ${EVM_A}  `)).toBe('ethereum')
  })
})

describe('extractWhaleAlertLeads — whale-alert → ingestion leads', () => {
  it('skips exchange-to-exchange transfers (both sides are names)', () => {
    const out = extractWhaleAlertLeads([item()])
    expect(out).toEqual([])
  })

  it('extracts a lead when the destination is an EVM address', () => {
    const out = extractWhaleAlertLeads([item({ to: EVM_A })])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      address: EVM_A,
      chain: 'ethereum',
      side: 'to',
      usd: 6_000_000,
      symbol: 'BTC',
      source: 'whale-alert',
    })
  })

  it('extracts a lead when the sender is a Solana address', () => {
    const out = extractWhaleAlertLeads([item({ from: SOL_A })])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      address: SOL_A,
      chain: 'solana',
      side: 'from',
    })
  })

  it('produces two leads when both sides are addresses', () => {
    const out = extractWhaleAlertLeads([item({ from: EVM_A, to: EVM_B })])
    expect(out).toHaveLength(2)
    expect(out.map((l) => l.side).sort()).toEqual(['from', 'to'])
  })

  it('skips transfers below the USD floor', () => {
    const out = extractWhaleAlertLeads([item({ to: EVM_A, usd: 4_999_999 })])
    expect(out).toEqual([])
  })

  it('respects a custom minUsd override', () => {
    const below = extractWhaleAlertLeads([item({ to: EVM_A, usd: 100_000 })], { minUsd: 50_000 })
    expect(below).toHaveLength(1)
    const above = extractWhaleAlertLeads([item({ to: EVM_A, usd: 100_000 })], { minUsd: 200_000 })
    expect(above).toEqual([])
  })

  it('skips items with invalid USD (NEVER fabricates — no zero-dollar leads)', () => {
    const nan = extractWhaleAlertLeads([item({ to: EVM_A, usd: NaN })])
    const neg = extractWhaleAlertLeads([item({ to: EVM_A, usd: -1 })])
    const inf = extractWhaleAlertLeads([item({ to: EVM_A, usd: Infinity })])
    expect(nan).toEqual([])
    expect(neg).toEqual([])
    expect(inf).toEqual([])
  })

  it('default floor matches the whale-transfers provider threshold ($5M)', () => {
    expect(WHALE_ALERT_LEAD_DEFAULT_MIN_USD).toBe(5_000_000)
  })
})
