import { describe, it, expect, vi } from 'vitest'
import {
  parseCommand,
  handleCommand,
  formatScanResult,
  formatLogEntry,
  formatTopEntries,
  formatCheckVerdict,
  type CommandDeps,
} from '../sniper-bot'
import type { SniperScanResult } from '../sniper-scan'
import type { SniperLogEntry } from '../sniper-log'
import type { SniperDecision, SniperMetrics } from '../meme-sniper-types'

// ── Fixtures ────────────────────────────────────────────────────

const VALID_CA = 'So11111111111111111111111111111111111111112'

/** Every metric field proven-clean; individual tests override as needed. */
function metrics(over: Partial<SniperMetrics> = {}): SniperMetrics {
  return {
    stage: 'new-pair',
    ageMinutes: 10,
    ageLabel: '10m',
    stageLabel: 'New Pair',
    volMcRatio: 2.5,
    requiredRatio: 2,
    devPercent: 0,
    sniperPercent: 0,
    bundlerPercent: 0,
    insiderPercent: 0,
    top10Percent: 20,
    clusterPercent: 0,
    avgPnlPercent: 20,
    pnlAssessment: 'neutral',
    ...over,
  }
}

function decision(over: Partial<SniperDecision> = {}): SniperDecision {
  return {
    status: 'SIGNAL',
    rationale: 'all hard filters passed',
    rejections: [],
    warnings: [],
    alert: 'alert-body',
    metrics: metrics(),
    ...over,
  }
}

function logEntry(over: Partial<SniperLogEntry> = {}): SniperLogEntry {
  return {
    contract: VALID_CA,
    ticker: 'TEST',
    tier: 'HIGH_CONVICTION',
    status: 'SIGNAL',
    delivered: true,
    deduped: false,
    auditsUsed: ['rugcheck'],
    tierReasons: ['verified'],
    tierMissing: [],
    smartMoneyBuyers: 2,
    smartMoneyStrongest: 'alpha-whale',
    smartMoneySource: 'wallet-cluster',
    discoveryCategory: 'MULTI_SOURCE',
    discoveryEvidence: [],
    market: { marketCapUsd: 100_000, liquidityUsd: 20_000, volume5mUsd: 5_000, priceUsd: 0.05 },
    rationale: 'pass',
    rejections: [],
    warnings: [],
    metrics: metrics(),
    ...over,
  }
}

// ── parseCommand ────────────────────────────────────────────────

describe('parseCommand', () => {
  it('parses /scan with an @botname suffix and case-insensitively', () => {
    expect(parseCommand('/scan')).toEqual({ cmd: 'scan' })
    expect(parseCommand('/scan@Vilonasnipercoinbot')).toEqual({ cmd: 'scan' })
    expect(parseCommand('  /scan  ')).toEqual({ cmd: 'scan' })
    expect(parseCommand('/SCAN')).toEqual({ cmd: 'scan' })
  })

  it('parses /top with an @botname suffix', () => {
    expect(parseCommand('/top')).toEqual({ cmd: 'top' })
    expect(parseCommand('/top@Vilonasnipercoinbot')).toEqual({ cmd: 'top' })
  })

  it('parses /check with a valid base58 contract', () => {
    expect(parseCommand(`/check ${VALID_CA}`)).toEqual({ cmd: 'check', contract: VALID_CA })
    expect(parseCommand(`/check@Vilonasnipercoinbot ${VALID_CA}`)).toEqual({
      cmd: 'check',
      contract: VALID_CA,
    })
  })

  it('treats bare /check as unknown', () => {
    expect(parseCommand('/check')).toEqual({ cmd: 'unknown', raw: '/check' })
  })

  it('treats /check with a non-base58 argument as unknown', () => {
    // '0' and 'O' are excluded from base58 — a mistyped CA must not be screened.
    expect(parseCommand('/check 0OIl')).toEqual({ cmd: 'unknown', raw: '/check 0OIl' })
  })

  it('returns empty for non-command text', () => {
    expect(parseCommand('')).toEqual({ cmd: 'empty' })
    expect(parseCommand('   ')).toEqual({ cmd: 'empty' })
    expect(parseCommand('hello there')).toEqual({ cmd: 'empty' })
  })

  it('returns unknown for unrecognized slash commands', () => {
    expect(parseCommand('/foo')).toEqual({ cmd: 'unknown', raw: '/foo' })
    expect(parseCommand('/help')).toEqual({ cmd: 'unknown', raw: '/help' })
  })
})

// ── handleCommand: auth gate + dispatch ─────────────────────────

describe('handleCommand', () => {
  const scanRes: SniperScanResult = {
    scanned: 10,
    screened: 2,
    watchlisted: 3,
    rejected: 5,
    rejectAudited: 5,
    rejectPreGate: 0,
    deduped: 1,
    delivered: 1,
    decisions: [],
    errors: [],
    categories: { NEW_PAIRS: 4 },
  }

  function deps(over: Partial<CommandDeps> = {}): CommandDeps {
    return {
      runScan: vi.fn().mockResolvedValue(scanRes),
      readLog: vi.fn().mockReturnValue({ entries: [], updatedAt: null, lastScan: null }),
      evalSniper: vi.fn().mockReturnValue(decision()),
      audit: vi.fn().mockResolvedValue([]),
      hydrate: vi.fn().mockResolvedValue({
        contract: VALID_CA,
        chain: 'solana',
        symbol: 'TEST',
        marketCap: 1000,
        liquidity: 5000,
        volume5m: 2500,
        createdAt: Date.now() - 1_000_000,
      }),
      ...over,
    }
  }

  it('rejects a non-whitelisted chat before running any command', async () => {
    const d = deps()
    const reply = await handleCommand({ cmd: 'scan' }, 'intruder', 'operator', d)
    expect(reply).toBe('⛔ Unauthorized')
    expect(d.runScan).not.toHaveBeenCalled()
    expect(d.readLog).not.toHaveBeenCalled()
    expect(d.evalSniper).not.toHaveBeenCalled()
  })

  it('rejects when no admin chat is configured', async () => {
    const d = deps()
    const reply = await handleCommand({ cmd: 'scan' }, 'operator', '', d)
    expect(reply).toBe('⛔ Unauthorized')
    expect(d.runScan).not.toHaveBeenCalled()
  })

  it('dispatches /scan without delivering alerts', async () => {
    const d = deps()
    const reply = await handleCommand({ cmd: 'scan' }, 'operator', 'operator', d)
    expect(d.runScan).toHaveBeenCalledWith({ limit: 3, deliver: false })
    expect(reply).toContain('Sniper Scan Pass')
    expect(reply).toContain('Scanned: 10')
  })

  it('dispatches /top to the log reader', async () => {
    const d = deps({ readLog: vi.fn().mockReturnValue({ entries: [logEntry()], updatedAt: 'x', lastScan: null }) })
    const reply = await handleCommand({ cmd: 'top' }, 'operator', 'operator', d)
    expect(d.readLog).toHaveBeenCalled()
    expect(reply).toContain('Recent Signals')
    expect(reply).toContain('TEST')
  })

  it('dispatches /check through audit + evaluator (market hydrated first)', async () => {
    const hydrate = vi.fn().mockResolvedValue({
      contract: VALID_CA,
      chain: 'solana',
      symbol: 'TEST',
      marketCap: 1000,
      liquidity: 5000,
      volume5m: 2500,
      createdAt: Date.now() - 1_000_000,
    })
    const audit = vi.fn().mockResolvedValue([
      {
        id: `solana:${VALID_CA}`,
        name: 'Test token',
        platform: 'rugcheck',
        contract: VALID_CA,
        symbol: 'TEST',
        riskLevel: 0,
        riskLabel: 'safe',
        buyTax: 0,
        sellTax: 0,
        top10HolderPercent: 0.2,
        lpLockedPercent: 0.5,
        canFreeze: false,
        canMint: false,
        isHoneypot: false,
        riskCounts: { high: 0, middle: 0, low: 0 },
        auditedAt: Date.now(),
      },
    ])
    const evalSniper = vi.fn().mockReturnValue(
      decision({ status: 'REJECT', rationale: 'insufficient liquidity', rejections: ['liquidity below 5k'] }),
    )
    const d = deps({ hydrate, audit, evalSniper })
    const reply = await handleCommand({ cmd: 'check', contract: VALID_CA }, 'operator', 'operator', d)
    // Market hydrates first; only when a row is found does the audit fan-out fire.
    expect(d.hydrate).toHaveBeenCalledWith('solana', VALID_CA)
    expect(d.audit).toHaveBeenCalledWith('solana', VALID_CA)
    expect(d.evalSniper).toHaveBeenCalledTimes(1)
    // evalSniper received a payload built by toSniperPayload from the hydrated
    // row + accepted audits — NOT the all-null payloadFromContract stub.
    const payload = evalSniper.mock.calls[0][0]
    expect(payload.contract).toBe(VALID_CA)
    expect(payload.momentum.marketCap).not.toBeNull()
    expect(reply).toContain('Sniper Check')
    expect(reply).toContain('REJECT')
    expect(reply).toContain('insufficient liquidity')
  })

  it('reports no verdict when the market row is absent (no audit performed)', async () => {
    const d = deps({ hydrate: vi.fn().mockResolvedValue(null) })
    const reply = await handleCommand({ cmd: 'check', contract: VALID_CA }, 'operator', 'operator', d)
    expect(d.audit).not.toHaveBeenCalled()
    expect(d.evalSniper).not.toHaveBeenCalled()
    expect(reply).toContain('Verdict unavailable')
    expect(reply).toContain(VALID_CA)
  })
  it('reports no verdict when every audit is unavailable', async () => {
    const d = deps()
    const reply = await handleCommand({ cmd: 'check', contract: VALID_CA }, 'operator', 'operator', d)
    expect(d.evalSniper).not.toHaveBeenCalled()
    expect(reply).toContain('Audit unavailable')
    expect(reply).toContain(VALID_CA)
  })

  it('reports no verdict when no audit matches the contract', async () => {
    const d = deps({
      audit: vi.fn().mockResolvedValue([{ contract: 'different-contract', symbol: 'TEST' }]),
    })
    const reply = await handleCommand({ cmd: 'check', contract: VALID_CA }, 'operator', 'operator', d)
    expect(d.evalSniper).not.toHaveBeenCalled()
    expect(reply).toContain('Audit unavailable')
  })

  it('returns the help menu for an unknown command', async () => {
    const reply = await handleCommand({ cmd: 'unknown', raw: '/foo' }, 'operator', 'operator', deps())
    expect(reply).toContain('Unknown command')
    expect(reply).toContain('/scan')
    expect(reply).toContain('/top')
    expect(reply).toContain('/check')
  })

  it('returns null for a non-command message', async () => {
    expect(await handleCommand({ cmd: 'empty' }, 'operator', 'operator', deps())).toBeNull()
  })
})

// ── Formatters ──────────────────────────────────────────────────

describe('formatScanResult', () => {
  it('summarizes counts, top signals, and errors', () => {
    const res: SniperScanResult = {
      scanned: 5,
      screened: 2,
      watchlisted: 1,
      rejected: 2,
      rejectAudited: 2,
      rejectPreGate: 0,
      deduped: 0,
      delivered: 1,
      decisions: [
        {
          ...decision(),
          contract: VALID_CA,
          ticker: 'T1',
          deduped: false,
          delivered: true,
          auditsUsed: [],
          tier: 'HIGH_CONVICTION',
          tierReasons: [],
          tierMissing: [],
          smartMoneyBuyers: 0,
          smartMoneyStrongest: null,
          smartMoneySource: 'none',
          discoveryCategory: 'MULTI_SOURCE',
          discoveryEvidence: [],
          market: { marketCapUsd: 1, liquidityUsd: 1, volume5mUsd: 1, priceUsd: 1 },
        },
      ],
      errors: ['RPC timeout on token X'],
      categories: {},
    }
    const text = formatScanResult(res)
    expect(text).toContain('Sniper Scan Pass')
    expect(text).toContain('Scanned: 5')
    expect(text).toContain('Top signals: 1')
    expect(text).toContain('Errors (1):')
    expect(text).toContain('RPC timeout on token X')
  })
})

describe('formatTopEntries', () => {
  it('handles an empty log honestly', () => {
    expect(formatTopEntries([])).toContain('No entries in the sniper log yet')
  })

  it('caps output at the newest five entries', () => {
    const entries = Array.from({ length: 7 }, () => logEntry())
    const text = formatTopEntries(entries)
    expect(text).toContain('Recent Signals (top 5)')
    expect(text).toContain('5.')
    expect(text).not.toContain('6.')
  })
})

describe('formatLogEntry', () => {
  it('renders tier, ticker, status, and delivery marker', () => {
    const text = formatLogEntry(logEntry(), 0)
    expect(text).toContain('1. <b>[HIGH_CONVICTION]</b> TEST — SIGNAL ✉')
    expect(text).toContain(`<code>${VALID_CA}</code>`)
    expect(text).toContain('Vol/MC: 2.50x')
  })
})

describe('formatCheckVerdict', () => {
  it('renders a SIGNAL verdict with metrics', () => {
    const text = formatCheckVerdict(
      decision({ warnings: ['slightly low liquidity'], metrics: metrics({ devPercent: 1.5, sniperPercent: 3 }) }),
      VALID_CA,
    )
    expect(text).toContain('✅ <b>Sniper Check</b>')
    expect(text).toContain('Verdict: <b>SIGNAL</b>')
    expect(text).toContain('Warnings:')
    expect(text).toContain('slightly low liquidity')
    expect(text).toContain('Dev: 1.5% | Sniper: 3% | Bundler: 0%')
  })

  it('renders a REJECT verdict with every rejection', () => {
    const text = formatCheckVerdict(
      decision({ status: 'REJECT', rationale: 'breaches', rejections: ['honeypot', 'dev holds 4%'] }),
      VALID_CA,
    )
    expect(text).toContain('🔴 <b>Sniper Check</b>')
    expect(text).toContain('Verdict: <b>REJECT</b>')
    expect(text).toContain('Rejections (2):')
    expect(text).toContain('honeypot')
  })

  it('escapes HTML in a hostile contract/ticker value', () => {
    const text = formatCheckVerdict(decision({ rationale: '<script>alert(1)</script>' }), VALID_CA)
    expect(text).toContain('&lt;script&gt;')
    expect(text).not.toContain('<script>')
  })
})


// ── Polling (execute-once + offset + chunking) ─────────────────

describe('processTelegramUpdates', () => {
  const commandDeps = (over: Partial<CommandDeps> = {}): CommandDeps =>
    ({
      runScan: vi.fn(async () => ({ scanned: 0, screened: 0, delivered: 0, rejected: 0, watchlisted: 0, errors: [], decisions: [] })),
      readLog: vi.fn(() => ({ entries: [] })),
      evalSniper: vi.fn(),
      hydrate: vi.fn(async () => null),
      audit: vi.fn(async () => []),
      ...over,
    }) as unknown as CommandDeps

  function stubFetch(
    handler: (url: string, init?: { body?: string }) => Promise<Response>,
  ): () => void {
    const original = globalThis.fetch
    globalThis.fetch = handler as unknown as typeof globalThis.fetch
    return () => {
      globalThis.fetch = original
    }
  }

  it('empty batch preserves caller offset (never resets to 0)', async () => {
    const { processTelegramUpdates } = await import('../sniper-bot')
    expect(await processTelegramUpdates('tok', '111', [], commandDeps(), 2, 42)).toBe(42)
  })

  it('advances offset per handled update and executes each command once', async () => {
    const { processTelegramUpdates } = await import('../sniper-bot')
    const runScan = vi.fn(async () => ({ scanned: 0, screened: 0, delivered: 0, rejected: 0, watchlisted: 0, errors: [], decisions: [] }))
    const restore = stubFetch(async () => ({ ok: true }) as unknown as Response)
    try {
      const next = await processTelegramUpdates(
        'tok',
        '111',
        [
          { update_id: 7, message: { chat: { id: 111 }, text: '/scan' } },
          { update_id: 8, message: { chat: { id: 111 }, text: '/scan' } },
        ],
        commandDeps({ runScan: runScan as unknown as CommandDeps['runScan'] }),
        2,
        5,
      )
      expect(next).toBe(9)
      expect(runScan).toHaveBeenCalledTimes(2)
    } finally {
      restore()
    }
  })

  it('retries only the cached reply after a send failure (no command re-run)', async () => {
    const { processTelegramUpdates } = await import('../sniper-bot')
    const runScan = vi.fn(async () => ({ scanned: 0, screened: 0, delivered: 0, rejected: 0, watchlisted: 0, errors: [], decisions: [] }))
    let attempt = 0
    const restore = stubFetch(async () => {
      attempt++
      if (attempt === 1) {
        return { ok: false, status: 500, text: async () => 'err' } as unknown as Response
      }
      return { ok: true } as unknown as Response
    })
    try {
      const next = await processTelegramUpdates(
        'tok',
        '111',
        [{ update_id: 3, message: { chat: { id: 111 }, text: '/scan' } }],
        commandDeps({ runScan: runScan as unknown as CommandDeps['runScan'] }),
        2,
        0,
      )
      expect(attempt).toBe(2)
      expect(runScan).toHaveBeenCalledTimes(1)
      expect(next).toBe(4)
    } finally {
      restore()
    }
  })

  it('never sends a chunk above the Telegram limit', async () => {
    const { processTelegramUpdates } = await import('../sniper-bot')
    const sent: string[] = []
    const restore = stubFetch(async (_url, init) => {
      sent.push(JSON.parse(String(init?.body)).text as string)
      return { ok: true } as unknown as Response
    })
    try {
      await processTelegramUpdates(
        'tok',
        '111',
        [{ update_id: 1, message: { chat: { id: 111 }, text: '/scan' } }],
        commandDeps(),
        2,
        0,
      )
    } finally {
      restore()
    }
    expect(sent.length).toBeGreaterThanOrEqual(1)
    for (const chunk of sent) expect(chunk.length).toBeLessThanOrEqual(4096)
  })

  it('a thrown command does not abort the batch', async () => {
    const { processTelegramUpdates } = await import('../sniper-bot')
    const restore = stubFetch(async () => ({ ok: true }) as unknown as Response)
    const readLog = vi.fn(() => ({ entries: [] }))
    const runScan = vi.fn(async () => {
      throw new Error('boom')
    })
    try {
      const next = await processTelegramUpdates(
        'tok',
        '111',
        [
          { update_id: 11, message: { chat: { id: 111 }, text: '/scan' } },
          { update_id: 12, message: { chat: { id: 111 }, text: '/top' } },
        ],
        commandDeps({
          runScan: runScan as unknown as CommandDeps['runScan'],
          readLog: readLog as unknown as CommandDeps['readLog'],
        }),
        2,
        0,
      )
      expect(next).toBe(13)
      expect(readLog).toHaveBeenCalledTimes(1)
    } finally {
      restore()
    }
  })
})
