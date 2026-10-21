import { describe, it, expect } from 'vitest'
import { ESLint } from 'eslint'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * Contract tests for the local integrity rule.
 *
 * A lint rule with no test is a rule that can silently stop working — an
 * ESLint config change, a flat-config API change, or a typo in the rule
 * name would leave the guard disabled and nobody would notice. These tests
 * run the rule through the real ESLint engine.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RULE_PATH = path.resolve(__dirname, '../../../../../eslint-rules/no-silent-empty-result.mjs')

async function lint(code: string): Promise<string[]> {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.ts'],
        plugins: { integrity: { rules: { 'no-silent-empty-result': (await import(RULE_PATH)).default } } },
        rules: { 'integrity/no-silent-empty-result': 'error' },
        languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
      },
    ],
  })
  const results = await eslint.lintText(code, { filePath: 'probe.ts' })
  return results[0].messages.map((m) => m.message)
}

describe('integrity/no-silent-empty-result', () => {
  it('flags a catch that returns [] with no evidence', async () => {
    const msgs = await lint(`
      export async function f() {
        try { return await g() } catch (err) { return [] }
      }
    `)
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toContain('swallows the error')
  })

  it('flags a catch that returns null with no evidence', async () => {
    const msgs = await lint(`
      export async function f() {
        try { return await g() } catch (err) { return null }
      }
    `)
    expect(msgs).toHaveLength(1)
  })

  it('allows a catch that logs the error', async () => {
    const msgs = await lint(`
      export async function f() {
        try { return await g() } catch (err) { console.error('boom', err); return [] }
      }
    `)
    expect(msgs).toHaveLength(0)
  })

  it('allows a catch that pushes to an errors array', async () => {
    const msgs = await lint(`
      export async function f() {
        try { return await g() } catch (err) { errors.push(String(err)); return [] }
      }
    `)
    expect(msgs).toHaveLength(0)
  })

  it('allows a catch that rethrows', async () => {
    const msgs = await lint(`
      export async function f() {
        try { return await g() } catch (err) { throw err }
      }
    `)
    expect(msgs).toHaveLength(0)
  })

  it('allows a catch that rejects a promise', async () => {
    const msgs = await lint(`
      export function f() {
        return new Promise((resolve, reject) => {
          try { resolve(1) } catch (err) { reject(err); return }
        })
      }
    `)
    expect(msgs).toHaveLength(0)
  })

  it('allows a catch that returns a non-empty result', async () => {
    const msgs = await lint(`
      export async function f() {
        try { return await g() } catch (err) { return { data: null, error: String(err) } }
      }
    `)
    expect(msgs).toHaveLength(0)
  })

  it('does not flag a catch whose result is a real value', async () => {
    const msgs = await lint(`
      export async function f() {
        try { return await g() } catch (err) { return 42 }
      }
    `)
    expect(msgs).toHaveLength(0)
  })

  it('ignores an empty catch block (no error to swallow)', async () => {
    const msgs = await lint(`
      export async function f() {
        try { return await g() } catch { }
      }
    `)
    expect(msgs).toHaveLength(0)
  })
})
