import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const statePath = vi.hoisted(() => ({ current: '' }))
const renameFailure = vi.hoisted(() => ({ active: false }))
const alphaSignals = vi.hoisted(() => ({ value: [] as unknown[] }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    renameSync: vi.fn((from: string, to: string) => {
      if (renameFailure.active) throw new Error('rename blocked')
      actual.renameSync(from, to)
    }),
  }
})

vi.mock('@/lib/modules/derived/alpha-engine', () => ({
  getAlphaSignals: vi.fn(async () => ({
    signals: alphaSignals.value,
    sourceCount: 0,
    timestamp: Date.now(),
  })),
}))

function signal(id: string, confidence = 80) {
  return {
    id,
    symbol: 'BTC',
    direction: 'bullish' as const,
    strength: 1,
    confidence,
    sources: ['test'],
    reasoning: 'test signal',
    timestamp: Date.now(),
    entry: 100,
    tp1: null,
    tp2: null,
    tp3: null,
    sl: null,
    validPeriod: '24h' as const,
    expiresAt: Date.now() + 3_600_000,
  }
}

async function load() {
  vi.resetModules()
  return import('../signal-publisher')
}

function readDisk() {
  return JSON.parse(readFileSync(statePath.current, 'utf8')) as {
    subscribers: string[]
    broadcastedSignals: string[]
  }
}

const originalStatePath = process.env.TELEGRAM_SIGNAL_STATE_PATH
const originalBotToken = process.env.TELEGRAM_BOT_TOKEN
const tempDirectories: string[] = []

describe('signal publisher durable storage', () => {
  beforeEach(() => {
    const directory = mkdtempSync(join(tmpdir(), 'signal-publisher-'))
    tempDirectories.push(directory)
    statePath.current = join(directory, 'state', 'signal-state.json')
    process.env.TELEGRAM_SIGNAL_STATE_PATH = statePath.current
    delete process.env.TELEGRAM_BOT_TOKEN
    renameFailure.active = false
    alphaSignals.value = []
  })

  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
    if (originalStatePath === undefined) delete process.env.TELEGRAM_SIGNAL_STATE_PATH
    else process.env.TELEGRAM_SIGNAL_STATE_PATH = originalStatePath
    if (originalBotToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN
    else process.env.TELEGRAM_BOT_TOKEN = originalBotToken
    renameFailure.active = false
  })

  it('persists subscriptions across process reloads through an atomic rename', async () => {
    const first = await load()
    expect(first.subscribeSignals('101')).toBe(true)
    expect(first.subscribeSignals('101')).toBe(true)

    const second = await load()
    expect(second.isSubscribedToSignals('101')).toBe(true)
    expect(second.getSignalSubscriberCount()).toBe(1)

    const dir = join(statePath.current, '..')
    expect(readdirSync(dir).some(name => name.endsWith('.tmp') || name.endsWith('.lock'))).toBe(false)
  })

  it('reports unsubscribe status honestly and survives reloads', async () => {
    const first = await load()
    first.subscribeSignals('202')

    expect(first.unsubscribeSignalsWithStatus('202')).toEqual({ persisted: true, wasSubscribed: true })
    expect(first.unsubscribeSignalsWithStatus('202')).toEqual({ persisted: true, wasSubscribed: false })

    const second = await load()
    expect(second.isSubscribedToSignals('202')).toBe(false)
    expect(readDisk().subscribers).toEqual([])
  })

  it('dedupes broadcasts, skips low confidence, and caps the dedup store', async () => {
    const publisher = await load()
    publisher.subscribeSignals('303')
    alphaSignals.value = [signal('sig-a'), signal('sig-b', 10)]

    const first = await publisher.fetchAndBroadcastSignals()
    expect(first).toEqual({ newSignals: 1, broadcastTo: 1, sent: 0, failed: 1 })

    const again = await publisher.fetchAndBroadcastSignals()
    expect(again.newSignals).toBe(0)
    expect(readDisk().broadcastedSignals).toEqual(['sig-a'])

    alphaSignals.value = Array.from({ length: 520 }, (_, i) => signal(`bulk-${i}`))
    alphaSignals.value.unshift(signal('sig-a'))
    await publisher.fetchAndBroadcastSignals()

    const stored = readDisk().broadcastedSignals
    expect(stored.length).toBe(500)
    expect(stored.at(-1)).toBe('bulk-519')
  })

  it('reads a corrupt state file as empty instead of throwing', async () => {
    mkdirSync(join(statePath.current, '..'), { recursive: true })
    writeFileSync(statePath.current, '{not json', 'utf8')
    const publisher = await load()

    expect(publisher.getSignalSubscriberCount()).toBe(0)
    expect(publisher.isSubscribedToSignals('404')).toBe(false)
  })

  it('reclaims a stale lock file left by a dead worker', async () => {
    mkdirSync(join(statePath.current, '..'), { recursive: true })
    writeFileSync(`${statePath.current}.lock`, '999999', 'utf8')
    utimesSync(`${statePath.current}.lock`, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000))

    const publisher = await load()
    expect(publisher.subscribeSignals('505')).toBe(true)
    expect(publisher.isSubscribedToSignals('505')).toBe(true)
    expect(readdirSync(join(statePath.current, '..'))).toEqual(['signal-state.json'])
  })

  it('surfaces storage failures without throwing or claiming success', async () => {
    const blocker = join(mkdtempSync(join(tmpdir(), 'signal-publisher-blocked-')), 'file')
    writeFileSync(blocker, 'blocked', 'utf8')
    process.env.TELEGRAM_SIGNAL_STATE_PATH = join(blocker, 'state.json')

    const publisher = await load()
    expect(publisher.subscribeSignals('606')).toBe(false)
    expect(publisher.unsubscribeSignalsWithStatus('606')).toEqual({ persisted: false, wasSubscribed: false })
    expect(publisher.getSignalSubscriberCount()).toBe(0)
    expect(await publisher.fetchAndBroadcastSignals()).toEqual({ newSignals: 0, broadcastTo: 0, sent: 0, failed: 0 })
  })

  it('cleans temporary files and locks when the atomic rename fails', async () => {
    const publisher = await load()
    expect(publisher.subscribeSignals('old')).toBe(true)

    renameFailure.active = true
    expect(publisher.subscribeSignals('707')).toBe(false)
    renameFailure.active = false

    expect(publisher.isSubscribedToSignals('707')).toBe(false)
    expect(publisher.isSubscribedToSignals('old')).toBe(true)
    const names = readdirSync(join(statePath.current, '..'))
    expect(names.some(name => name.endsWith('.tmp') || name.endsWith('.lock'))).toBe(false)
  })
})
