import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const REVIEW = 'resolveReviewChatId()'

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'node_modules') continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full)
  }
  return out
}

const FILES = walk(SRC)

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}

describe('operator-only Telegram surfaces', () => {
  it('never passes an unguarded review chat id into deliverSniperAlert', () => {
    const offenders: string[] = []
    for (const file of FILES) {
      const src = readFileSync(file, 'utf8')
      const calls = src.matchAll(/deliverSniperAlert\(/g)
      for (const call of calls) {
        const tail = src.slice(call.index ?? 0, (call.index ?? 0) + 400)
        if (!tail.includes(REVIEW)) continue
        const before = src.slice(Math.max(0, (call.index ?? 0) - 700), call.index ?? 0)
        const guarded =
          /reviewChat\s*(?:!==|===)\s*''/.test(before) ||
          /reviewChat\s*\?/.test(before) ||
          /if\s*\(\s*chat\s*\)/.test(before) ||
          /chat\s*:\s*\[\]/.test(before)
        if (!guarded) offenders.push(`${path.relative(SRC, file)}:${lineOf(src, call.index ?? 0)}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('resolves the review chat without falling back to the sale channel', () => {
    const src = readFileSync(path.join(SRC, 'lib/modules/derived/meme-sniper-delivery.ts'), 'utf8')
    const start = src.indexOf('export function resolveReviewChatId')
    expect(start).toBeGreaterThan(-1)
    const body = src.slice(start, src.indexOf('\n}\n', start))
    expect(body).not.toContain('SNIPER_TELEGRAM_CHAT_ID')
    expect(body).not.toContain('HUB_TELEGRAM_ALERT_CHAT_ID')
  })

  it('keeps the public-channel push confined to the sniper cron and scan core', () => {
    const allowed = new Set([
      'scripts/sniper-cron.ts',
      'lib/modules/derived/sniper-scan-core.ts',
      'lib/modules/derived/sniper-review.ts',
      'lib/modules/derived/meme-sniper-delivery.ts',
    ])
    const channelPushers = FILES.filter((file) => {
      const src = readFileSync(file, 'utf8')
      return /deliverSniperAlert\(\s*[^,)]*,\s*undefined/.test(src)
    }).map((file) => path.relative(SRC, file))
    const unexpected = channelPushers.filter((f) => !allowed.has(f.replace(/\\/g, '/')))
    expect(unexpected).toEqual([])
    expect(channelPushers.map((f) => f.replace(/\\/g, '/'))).toContain('lib/modules/derived/sniper-scan-core.ts')
  })
})
