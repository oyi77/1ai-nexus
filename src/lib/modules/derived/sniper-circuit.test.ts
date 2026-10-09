// Contract tests: daily sniper stop circuit — streak semantics, day
// rollover, corrupt-file resilience. Uses a temp state path (no prod file).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readSniperCircuit,
  recordSniperStopLoss,
  recordSniperWin,
  resetSniperCircuit,
  isSniperCircuitLocked,
  todayUtc,
} from './sniper-circuit'
import { MAX_CONSECUTIVE_STOP_LOSSES } from './meme-sniper'

let dir = ''
let path = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sniper-circuit-'))
  path = join(dir, 'sniper-circuit.json')
  process.env.SNIPER_CIRCUIT_PATH = path
})

afterEach(() => {
  delete process.env.SNIPER_CIRCUIT_PATH
  rmSync(dir, { recursive: true, force: true })
})

describe('sniper daily stop circuit', () => {
  it('starts a fresh day unlocked at zero', () => {
    const s = readSniperCircuit()
    expect(s).toMatchObject({ date: todayUtc(), consecutiveLosses: 0, wins: 0, locked: false })
    expect(isSniperCircuitLocked()).toBe(false)
  })

  it(`locks only on the ${MAX_CONSECUTIVE_STOP_LOSSES}rd consecutive stop-loss`, () => {
    expect(recordSniperStopLoss().locked).toBe(false)
    expect(recordSniperStopLoss().locked).toBe(false)
    expect(isSniperCircuitLocked()).toBe(false)
    const third = recordSniperStopLoss()
    expect(third.consecutiveLosses).toBe(3)
    expect(third.locked).toBe(true)
    expect(isSniperCircuitLocked()).toBe(true)
  })

  it('a win breaks the streak and clears the lock', () => {
    recordSniperStopLoss()
    recordSniperStopLoss()
    const afterWin = recordSniperWin()
    expect(afterWin.consecutiveLosses).toBe(0)
    expect(afterWin.locked).toBe(false)
    expect(afterWin.wins).toBe(1)
    // Streak restarts — two more losses must not lock.
    expect(recordSniperStopLoss().locked).toBe(false)
    expect(recordSniperStopLoss().locked).toBe(false)
  })

  it('scopes the streak to the UTC day', () => {
    recordSniperStopLoss()
    recordSniperStopLoss()
    recordSniperStopLoss()
    expect(isSniperCircuitLocked()).toBe(true)
    // Same instant next day → the lock does not carry over.
    const tomorrow = new Date(Date.now() + 24 * 60 * 60_000)
    expect(readSniperCircuit(tomorrow)).toMatchObject({ consecutiveLosses: 0, locked: false })
  })

  it('persists state across reads', () => {
    recordSniperStopLoss()
    recordSniperStopLoss()
    expect(readSniperCircuit().consecutiveLosses).toBe(2)
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    expect(raw.date).toBe(todayUtc())
    expect(raw.consecutiveLosses).toBe(2)
  })

  it('an explicit reset clears the streak and lock', () => {
    recordSniperStopLoss()
    recordSniperStopLoss()
    recordSniperStopLoss()
    const r = resetSniperCircuit()
    expect(r).toMatchObject({ consecutiveLosses: 0, locked: false })
    expect(isSniperCircuitLocked()).toBe(false)
  })

  it('a corrupt state file resets to a fresh day instead of bricking the sniper', () => {
    writeFileSync(path, '{not json')
    const s = readSniperCircuit()
    expect(s).toMatchObject({ consecutiveLosses: 0, locked: false })
    expect(isSniperCircuitLocked()).toBe(false)
  })
})
