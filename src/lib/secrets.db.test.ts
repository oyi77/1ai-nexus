// Q3 — DB-backed secrets regression (LIVE Postgres, probe keys only).
// Guards: IntegrationSecret table accepts write/read/delete, missing→null,
// resolver sees a staged DB credential, and cleanup restores prior state.
//
// SAFETY: the real `stockbit_refresh_token` row is NEVER overwritten. If an
// admin has one staged, the resolver half of this test skips (probe keys
// still verify the table + crypto path end to end).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'

const MASTER = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

beforeAll(() => {
  process.env.SECRETS_MASTER_KEY = MASTER
})

afterAll(async () => {
  await prisma.integrationSecret.deleteMany({
    where: { key: { startsWith: '__qa_probe__' } },
  })
  await prisma.$disconnect()
})

describe('secrets DB store (Q3, live DB)', () => {
  it('table roundtrip: write → read → missing → delete', async () => {
    const { writeSecret, readSecret } = await import('./secrets')
    await writeSecret('__qa_probe__roundtrip', 'probe-value-123')
    await expect(readSecret('__qa_probe__roundtrip')).resolves.toBe('probe-value-123')
    await expect(readSecret('__qa_probe__missing__')).resolves.toBeNull()
    await prisma.integrationSecret.deleteMany({ where: { key: '__qa_probe__roundtrip' } })
    await expect(readSecret('__qa_probe__roundtrip')).resolves.toBeNull()
  })

  it('stored value is ciphertext, never plaintext', async () => {
    const { writeSecret } = await import('./secrets')
    await writeSecret('__qa_probe__cipher', 'super-secret-rt-value')
    const row = await prisma.integrationSecret.findUnique({
      where: { key: '__qa_probe__cipher' },
    })
    expect(row).toBeTruthy()
    expect(row!.encValue).not.toContain('super-secret-rt-value')
    expect(row!.encValue).toMatch(/^v1\./)
    await prisma.integrationSecret.deleteMany({ where: { key: '__qa_probe__cipher' } })
  })

  it('resolver sees a staged DB credential (skips if admin has a real token)', async () => {
    const existing = await prisma.integrationSecret.findUnique({
      where: { key: 'stockbit_refresh_token' },
      select: { key: true },
    })
    if (existing) {
      console.log('skip: real stockbit_refresh_token staged — refusing to touch it')
      return
    }
    const { writeSecret } = await import('./secrets')
    const { hasSessionCredentialsAsync, resetStockbitSession } = await import(
      '@/lib/modules/market/provider/idx-stockbit/session'
    )
    resetStockbitSession()
    await writeSecret('stockbit_refresh_token', 'db-backed-rt-probe')
    await expect(hasSessionCredentialsAsync()).resolves.toBe(true)
    await prisma.integrationSecret.deleteMany({ where: { key: 'stockbit_refresh_token' } })
  })
})

