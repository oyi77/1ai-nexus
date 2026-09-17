// Q1 — secrets crypto unit tests (no network, no DB rows touched).
// Guards: roundtrip, wrong-key auth-tag failure, malformed blob, missing env.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const MASTER = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
let saved: string | undefined

beforeEach(async () => {
  saved = process.env.SECRETS_MASTER_KEY
  process.env.SECRETS_MASTER_KEY = MASTER
  vi.resetModules()
})

afterEach(() => {
  if (saved === undefined) delete process.env.SECRETS_MASTER_KEY
  else process.env.SECRETS_MASTER_KEY = saved
})

async function secrets() {
  return import('./secrets')
}

describe('secrets crypto (Q1)', () => {
  it('roundtrip encrypt→decrypt is identical (3 random values)', async () => {
    const { encryptSecret, decryptSecret } = await secrets()
    for (const plain of ['rt-jwt-value-1', 'x'.repeat(500), 'unicode-✓-token']) {
      expect(decryptSecret(encryptSecret(plain))).toBe(plain)
    }
  })

  it('two encryptions of the same value differ (random IV)', async () => {
    const { encryptSecret } = await secrets()
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'))
  })

  it('decrypt with the wrong master key throws (auth tag)', async () => {
    const { encryptSecret } = await secrets()
    const blob = encryptSecret('secret-value')
    process.env.SECRETS_MASTER_KEY =
      'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    vi.resetModules()
    const { decryptSecret } = await secrets()
    expect(() => decryptSecret(blob)).toThrow()
  })

  it('malformed blob throws, never crashes', async () => {
    const { decryptSecret } = await secrets()
    for (const bad of ['', 'v1.only.two', 'v2.a.b.c', 'not-a-blob']) {
      expect(() => decryptSecret(bad)).toThrow()
    }
  })

  it('missing SECRETS_MASTER_KEY throws an actionable error', async () => {
    delete process.env.SECRETS_MASTER_KEY
    vi.resetModules()
    const { encryptSecret } = await secrets()
    expect(() => encryptSecret('x')).toThrow(/SECRETS_MASTER_KEY/)
  })
})
