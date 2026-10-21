import { describe, it, expect } from 'vitest'
import {
  buildAlertMessage,
  newFailures,
  shouldAlert,
  type AuditCheckResult,
} from '@/lib/modules/derived/zero-issue-decision'

const ok = (name: string): AuditCheckResult => ({ name, ok: true, detail: 'ok' })
const bad = (name: string, detail = 'broken'): AuditCheckResult => ({ name, ok: false, detail })

describe('newFailures', () => {
  it('returns nothing when everything passes', () => {
    expect(newFailures([ok('a'), ok('b')], [])).toEqual([])
  })

  it('returns the failing checks', () => {
    expect(newFailures([ok('a'), bad('b')], [])).toEqual(['b'])
  })

  it('excludes failures that were already known', () => {
    expect(newFailures([bad('a'), bad('b')], ['a'])).toEqual(['b'])
  })

  it('treats a recovered-then-broken check as new again', () => {
    // 'a' recovered last run, so it is no longer in previousFailures.
    expect(newFailures([bad('a')], ['b'])).toEqual(['a'])
  })
})

describe('shouldAlert', () => {
  it('does not alert when everything passes', () => {
    expect(shouldAlert([ok('a')], [])).toBe(false)
  })

  it('alerts on a new failure', () => {
    expect(shouldAlert([ok('a'), bad('b')], [])).toBe(true)
  })

  it('does not re-alert a failure that is already known', () => {
    expect(shouldAlert([bad('a')], ['a'])).toBe(false)
  })

  it('alerts when a second check breaks while the first is still broken', () => {
    expect(shouldAlert([bad('a'), bad('b')], ['a'])).toBe(true)
  })
})

describe('buildAlertMessage', () => {
  it('returns null when there is nothing to report', () => {
    expect(buildAlertMessage([ok('a')], 3, [])).toBeNull()
  })

  it('includes the failure count, the detail and the new-failure list', () => {
    const msg = buildAlertMessage([ok('a'), bad('pipelines', 'stopped 40min ago')], 3, [])
    expect(msg).toContain('1/3 check(s) FAILED')
    expect(msg).toContain('pipelines: stopped 40min ago')
    expect(msg).toContain('new since last run: pipelines')
  })

  it('says so when the failures are not new', () => {
    const msg = buildAlertMessage([bad('pipelines', 'stopped')], 3, ['pipelines'])
    expect(msg).toContain('same failures as previous run')
  })

  it('lists every failure, not only the new ones', () => {
    const msg = buildAlertMessage([bad('a'), bad('b')], 2, ['a'])
    expect(msg).toContain('• a:')
    expect(msg).toContain('• b:')
  })
})
