// ─────────────────────────────────────────────────────────────
// Test-integrity gate — fails if any test file contains a local
// re-implementation of a production helper instead of importing it.
// The rss-parser.test.ts file originally duplicated extractTag/cleanHtml
// locally, which is why two real bugs survived a green suite.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Pure-parsing helpers that must be imported from production, not re-declared.
const PRODUCTION_HELPERS = [
  'cleanHtml',
  'extractTag',
  'extractLink',
  'parseRssItems',
  'parseRssXml',
  'decodeEntities',
  'stripHtml',
  'cleanCdata',
  'unwrapEnvelope',
  'apiSuccess',
  'apiError',
]

function findTestFiles(): string[] {
  const out: string[] = []
  function walk(dir: string) {
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name === 'node_modules') continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) { walk(full); continue }
      if (/\.test\.(ts|tsx)$/.test(e.name)) out.push(full)
    }
  }
  walk('src')
  return out
}

describe('Test Integrity Gate', () => {
  it('no test file re-implements a production helper locally', () => {
    const violations: string[] = []
    for (const file of findTestFiles()) {
      const content = fs.readFileSync(file, 'utf8')
      for (const helper of PRODUCTION_HELPERS) {
        // Match "function helperName(" or "const helperName ="
        const re = new RegExp(`(?:function|const)\\s+${helper}\\s*[=(]`)
        if (re.test(content)) {
          violations.push(`${file}: locally declares ${helper}`)
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([])
  })
})
