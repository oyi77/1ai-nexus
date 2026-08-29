// ─────────────────────────────────────────────────────────────
// BotX Auto-Registration & Credential Manager
//
// Manages multiple BotX API keys with automatic rotation,
// health checking, and rate-limit-resilient request handling.
//
// Uses node:sqlite (built into Node 22+) — no external deps.
// ─────────────────────────────────────────────────────────────

import { DatabaseSync } from 'node:sqlite'
import { randomBytes, createHash } from 'node:crypto'
import { join } from 'node:path'

// ── Types ────────────────────────────────────────────────────

export interface BotXKey {
  id: string
  apiKey: string
  email: string
  createdAt: number
  lastUsed: number
  lastChecked: number
  isHealthy: boolean
  rateLimited: boolean
  errorCount: number
  requestCount: number
}

export interface KeyStoreStats {
  total: number
  healthy: number
  rateLimited: number
  unhealthy: number
}

// ── Temp Email Service (mail.tm) ─────────────────────────────

interface MailTmAccount {
  address: string
  token: string
}

const MAIL_TM_BASE = 'https://api.mail.tm'

async function getMailTmDomains(): Promise<string[]> {
  const res = await fetch(`${MAIL_TM_BASE}/domains`)
  if (!res.ok) throw new Error(`mail.tm domains: HTTP ${res.status}`)
  const data = await res.json()
  return (data['hydra:member'] ?? []).map((d: { domain: string }) => d.domain)
}

async function createMailTmAccount(domain: string): Promise<MailTmAccount & { password: string }> {
  const username = `botx.${randomBytes(4).toString('hex')}`
  const address = `${username}@${domain}`
  const password = randomBytes(12).toString('base64url')

  const res = await fetch(`${MAIL_TM_BASE}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, password }),
  })
  // 201 = created, 400 = already exists (try login), 429 = rate limited
  if (res.status !== 201 && res.status !== 400) {
    throw new Error(`mail.tm create: HTTP ${res.status}`)
  }

  const loginRes = await fetch(`${MAIL_TM_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, password }),
  })
  // 200 = success, 201 = also accepted
  if (loginRes.status !== 200 && loginRes.status !== 201) {
    throw new Error(`mail.tm login: HTTP ${loginRes.status}`)
  }
  const { token } = await loginRes.json()
  if (!token) throw new Error(`mail.tm login: no token`)

  return { address, token, password }
}

async function getMailTmMessages(token: string): Promise<Array<{ id: string; subject: string; body: string }>> {
  const res = await fetch(`${MAIL_TM_BASE}/messages`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return []
  const data = await res.json()
  const messages = (data['hydra:member'] ?? []) as Array<{ id: string; subject: string; text?: string; html?: string }>

  const fullMessages = []
  for (const msg of messages) {
    const msgRes = await fetch(`${MAIL_TM_BASE}/messages/${msg.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (msgRes.ok) {
      const full = await msgRes.json()
      fullMessages.push({
        id: msg.id,
        subject: full.subject ?? msg.subject,
        body: full.text ?? full.html ?? '',
      })
    }
  }
  return fullMessages
}

// ── BotX Registration ────────────────────────────────────────

const BOTX_SIGNUP_URL = 'https://dbotx.com/api/auth/register'
const BOTX_LOGIN_URL = 'https://dbotx.com/api/auth/login'
const BOTX_API_KEY_URL = 'https://dbotx.com/api/user/api-key'

async function registerBotX(email: string, password: string): Promise<string> {
  const signupRes = await fetch(BOTX_SIGNUP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, confirmPassword: password }),
  })
  if (!signupRes.ok) {
    const body = await signupRes.text()
    throw new Error(`BotX signup failed: HTTP ${signupRes.status} - ${body}`)
  }

  const loginRes = await fetch(BOTX_LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!loginRes.ok) {
    const body = await loginRes.text()
    throw new Error(`BotX login failed: HTTP ${loginRes.status} - ${body}`)
  }

  const loginData = await loginRes.json()
  const sessionToken = loginData.token ?? loginData.accessToken
  if (!sessionToken) throw new Error(`BotX login: no token in response`)

  const keyRes = await fetch(BOTX_API_KEY_URL, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  })
  if (!keyRes.ok) {
    const body = await keyRes.text()
    throw new Error(`BotX API key fetch failed: HTTP ${keyRes.status} - ${body}`)
  }

  const keyData = await keyRes.json()
  const apiKey = keyData.apiKey ?? keyData.key ?? keyData.token
  if (!apiKey) throw new Error(`BotX API key: no key in response`)

  return apiKey
}

// ── Credential Manager ───────────────────────────────────────

export class CredentialManager {
  private db: DatabaseSync
  private currentKeyIndex = 0
  private keys: BotXKey[] = []

  constructor(dbPath?: string) {
    const path = dbPath ?? join(process.cwd(), 'data', 'botx-keys.sqlite')
    this.db = new DatabaseSync(path)
    this.initDb()
    this.loadKeys()
  }

  private initDb(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS botx_keys (
        id TEXT PRIMARY KEY,
        api_key TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used INTEGER NOT NULL,
        last_checked INTEGER NOT NULL,
        is_healthy INTEGER NOT NULL DEFAULT 1,
        rate_limited INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        request_count INTEGER NOT NULL DEFAULT 0
      )
    `)
  }

  private loadKeys(): void {
    const stmt = this.db.prepare(
      `SELECT id, api_key as apiKey, email, created_at as createdAt,
              last_used as lastUsed, last_checked as lastChecked,
              is_healthy as isHealthy, rate_limited as rateLimited,
              error_count as errorCount, request_count as requestCount
       FROM botx_keys
       ORDER BY created_at ASC`
    )
    const rows = stmt.all() as unknown as Array<Record<string, unknown>>
    this.keys = rows.map((r) => ({
      id: r.id as string,
      apiKey: r.apiKey as string,
      email: r.email as string,
      createdAt: r.createdAt as number,
      lastUsed: r.lastUsed as number,
      lastChecked: r.lastChecked as number,
      isHealthy: Boolean(r.isHealthy),
      rateLimited: Boolean(r.rateLimited),
      errorCount: (r.errorCount as number) || 0,
      requestCount: (r.requestCount as number) || 0,
    }))
  }

  getKeyCount(): number {
    return this.keys.length
  }

  getStats(): KeyStoreStats {
    return {
      total: this.keys.length,
      healthy: this.keys.filter((k) => k.isHealthy && !k.rateLimited).length,
      rateLimited: this.keys.filter((k) => k.rateLimited).length,
      unhealthy: this.keys.filter((k) => !k.isHealthy).length,
    }
  }

  getNextKey(): BotXKey | null {
    const healthyKeys = this.keys.filter((k) => k.isHealthy && !k.rateLimited)
    if (healthyKeys.length === 0) return null

    this.currentKeyIndex = (this.currentKeyIndex + 1) % healthyKeys.length
    const key = healthyKeys[this.currentKeyIndex]

    this.db.prepare(`UPDATE botx_keys SET last_used = ? WHERE id = ?`).run(Date.now(), key.id)
    key.lastUsed = Date.now()
    key.requestCount++

    return key
  }

  markRateLimited(keyId: string): void {
    this.db.prepare(`UPDATE botx_keys SET rate_limited = 1, error_count = error_count + 1 WHERE id = ?`).run(keyId)
    const key = this.keys.find((k) => k.id === keyId)
    if (key) {
      key.rateLimited = true
      key.errorCount++
    }
  }

  markHealthy(keyId: string): void {
    this.db.prepare(`UPDATE botx_keys SET is_healthy = 1, rate_limited = 0, last_checked = ? WHERE id = ?`).run(Date.now(), keyId)
    const key = this.keys.find((k) => k.id === keyId)
    if (key) {
      key.isHealthy = true
      key.rateLimited = false
      key.lastChecked = Date.now()
    }
  }

  markUnhealthy(keyId: string): void {
    this.db.prepare(`UPDATE botx_keys SET is_healthy = 0, last_checked = ? WHERE id = ?`).run(Date.now(), keyId)
    const key = this.keys.find((k) => k.id === keyId)
    if (key) {
      key.isHealthy = false
      key.lastChecked = Date.now()
    }
  }

  addKey(apiKey: string, email: string): BotXKey {
    const id = createHash('sha256').update(apiKey).digest('hex').slice(0, 16)
    const now = Date.now()
    const key: BotXKey = {
      id,
      apiKey,
      email,
      createdAt: now,
      lastUsed: now,
      lastChecked: now,
      isHealthy: true,
      rateLimited: false,
      errorCount: 0,
      requestCount: 0,
    }

    this.db
      .prepare(
        `INSERT OR REPLACE INTO botx_keys
         (id, api_key, email, created_at, last_used, last_checked, is_healthy, rate_limited, error_count, request_count)
         VALUES (?, ?, ?, ?, ?, ?, 1, 0, 0, 0)`
      )
      .run(id, apiKey, email, now, now, now)

    this.keys.push(key)
    return key
  }

  removeKey(keyId: string): void {
    this.db.prepare(`DELETE FROM botx_keys WHERE id = ?`).run(keyId)
    this.keys = this.keys.filter((k) => k.id !== keyId)
  }

  getAllKeys(): BotXKey[] {
    return [...this.keys]
  }

  close(): void {
    this.db.close()
  }
}

// ── Auto-Registration Worker ─────────────────────────────────

export class BotXRegistrationWorker {
  private credentialManager: CredentialManager

  constructor(credentialManager: CredentialManager) {
    this.credentialManager = credentialManager
  }

  async registerNewKey(): Promise<BotXKey> {
    const domains = await getMailTmDomains()
    if (domains.length === 0) throw new Error('No mail.tm domains available')
    const domain = domains[0]

    const account = await createMailTmAccount(domain)
    const password = account.password

    const apiKey = await registerBotX(account.address, password)

    // Verify key works
    const testRes = await fetch('https://api-data-v1.dbotx.com/kline/new?chain=solana&limit=1', {
      headers: { 'x-api-key': apiKey },
    })
    if (!testRes.ok) throw new Error(`BotX key verification failed: HTTP ${testRes.status}`)

    return this.credentialManager.addKey(apiKey, account.address)
  }

  async registerMultipleKeys(count: number): Promise<BotXKey[]> {
    const results: BotXKey[] = []
    for (let i = 0; i < count; i++) {
      try {
        const key = await this.registerNewKey()
        results.push(key)
        // Longer delay to avoid rate limits
        await new Promise((r) => setTimeout(r, 3000))
      } catch (e) {
        console.error(`Registration ${i + 1}/${count} failed:`, e)
        // Wait longer on failure (rate limit backoff)
        await new Promise((r) => setTimeout(r, 10000))
      }
    }
    return results
  }
}

// ── Health Checker ───────────────────────────────────────────

export class BotXHealthChecker {
  private credentialManager: CredentialManager

  constructor(credentialManager: CredentialManager) {
    this.credentialManager = credentialManager
  }

  async checkKey(key: BotXKey): Promise<boolean> {
    try {
      const res = await fetch('https://api-data-v1.dbotx.com/kline/new?chain=solana&limit=1', {
        headers: { 'x-api-key': key.apiKey },
      })

      if (res.status === 429) {
        this.credentialManager.markRateLimited(key.id)
        return false
      }

      if (!res.ok) {
        this.credentialManager.markUnhealthy(key.id)
        return false
      }

      this.credentialManager.markHealthy(key.id)
      return true
    } catch {
      this.credentialManager.markUnhealthy(key.id)
      return false
    }
  }

  async checkAllKeys(): Promise<{ healthy: number; unhealthy: number; rateLimited: number }> {
    const keys = this.credentialManager.getAllKeys()
    let healthy = 0, unhealthy = 0, rateLimited = 0

    for (const key of keys) {
      const isHealthy = await this.checkKey(key)
      if (isHealthy) healthy++
      else if (key.rateLimited) rateLimited++
      else unhealthy++
    }

    return { healthy, unhealthy, rateLimited }
  }
}

// ── Singleton Instance ───────────────────────────────────────

let credentialManagerInstance: CredentialManager | null = null

export function getCredentialManager(): CredentialManager {
  if (!credentialManagerInstance) {
    credentialManagerInstance = new CredentialManager()
  }
  return credentialManagerInstance
}
