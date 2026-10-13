import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  filterUnseenTransactions,
  markTransactionsSeen,
  KOLSCAN_SEEN_TTL_MS,
} from '../seen'
import type { KolscanScreenedTx } from '../index'

function tx(signature: string): KolscanScreenedTx {
  return {
    signature,
    walletAddress: 'D'.repeat(40),
    kolName: 'kol',
    timestamp: 1,
    solChange: 10,
    outTokenSymbol: 'TOK',
    outTokenAddress: 'E'.repeat(40),
    outAmount: 1000,
    inTokenSymbol: null,
    inTokenAddress: null,
    inAmount: 0,
    dex: 'Pump.fun',
    usdValue: 1600,
    screenReason: 'test',
  }
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kolscan-seen-'))
  process.env.KOLSCAN_SEEN_PATH = join(dir, 'seen.json')
})

afterEach(() => {
  delete process.env.KOLSCAN_SEEN_PATH
  rmSync(dir, { recursive: true, force: true })
})

describe('filterUnseenTransactions', () => {
  it('returns all txs when the seen file is missing', () => {
    const txs = [tx('a'), tx('b')]
    expect(filterUnseenTransactions(txs)).toEqual(txs)
  })

  it('drops txs whose signature is already stored', () => {
    markTransactionsSeen([tx('a')])
    const txs = [tx('a'), tx('b'), tx('a')]
    expect(filterUnseenTransactions(txs).map((t) => t.signature)).toEqual(['b'])
  })

  it('returns [] for empty input', () => {
    expect(filterUnseenTransactions([])).toEqual([])
  })
})

describe('markTransactionsSeen', () => {
  it('records signatures with epoch-ms seenAt values', () => {
    markTransactionsSeen([tx('sig1'), tx('sig2')])
    const raw = JSON.parse(readFileSync(join(dir, 'seen.json'), 'utf8')) as Record<string, number>
    expect(Object.keys(raw).sort()).toEqual(['sig1', 'sig2'])
    for (const v of Object.values(raw)) {
      expect(typeof v).toBe('number')
      expect(Date.now() - v).toBeLessThan(5_000)
    }
  })

  it('does not throw or create a file for empty input', () => {
    markTransactionsSeen([])
    expect(() => readFileSync(join(dir, 'seen.json'))).toThrow()
  })

  it('prunes entries older than the TTL on the next read', () => {
    const stale = Date.now() - KOLSCAN_SEEN_TTL_MS - 60_000
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'seen.json'), JSON.stringify({ old: stale, fresh: Date.now() }))
    const txs = [tx('old'), tx('fresh'), tx('new')]
    expect(filterUnseenTransactions(txs).map((t) => t.signature)).toEqual(['old', 'new'])
  })
})

describe('corrupt state', () => {
  it('reads a corrupt file as empty and still filters', () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'seen.json'), '{not valid json')
    const txs = [tx('a')]
    expect(filterUnseenTransactions(txs)).toEqual(txs)
  })

  it('reads a non-object JSON file as empty', () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'seen.json'), '[1,2,3]')
    expect(filterUnseenTransactions([tx('a')])).toHaveLength(1)
  })

  it('does not throw when the seen file cannot be written', () => {
    // A child path under a regular FILE makes mkdirSync throw immediately
    // (ENOTDIR/EEXIST) instead of hanging on a special filesystem.
    const blocker = join(dir, 'blocker')
    writeFileSync(blocker, 'x')
    process.env.KOLSCAN_SEEN_PATH = join(blocker, 'seen.json')
    expect(() => markTransactionsSeen([tx('a')])).not.toThrow()
  })
})
