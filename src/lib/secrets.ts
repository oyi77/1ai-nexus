// ─────────────────────────────────────────────────────────────
// Encrypted integration secrets — AES-256-GCM via stdlib node:crypto.
// Master key: SECRETS_MASTER_KEY env (64 hex chars = 32 bytes).
// Blob format: v1.<base64 iv>.<base64 ciphertext>.<base64 tag>.
// The master key and plaintext values are NEVER logged.
// SERVER-ONLY.
// ─────────────────────────────────────────────────────────────

import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import { prisma } from '@/lib/db'

function getMasterKey(): Buffer {
  const hex = process.env.SECRETS_MASTER_KEY ?? ''
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'SECRETS_MASTER_KEY must be 64 hex chars (32 bytes). Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    )
  }
  return Buffer.from(hex, 'hex')
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getMasterKey(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1.${iv.toString('base64')}.${ct.toString('base64')}.${tag.toString('base64')}`
}

export function decryptSecret(blob: string): string {
  const parts = blob.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Unknown secret blob version')
  const decipher = createDecipheriv('aes-256-gcm', getMasterKey(), Buffer.from(parts[1], 'base64'))
  decipher.setAuthTag(Buffer.from(parts[3], 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(parts[2], 'base64')), decipher.final()]).toString('utf8')
}

export async function readSecret(key: string): Promise<string | null> {
  const row = await prisma.integrationSecret.findUnique({ where: { key } })
  if (!row) return null
  return decryptSecret(row.encValue)
}

export async function writeSecret(key: string, plain: string): Promise<void> {
  await prisma.integrationSecret.upsert({
    where: { key },
    create: { key, encValue: encryptSecret(plain) },
    update: { encValue: encryptSecret(plain) },
  })
}
