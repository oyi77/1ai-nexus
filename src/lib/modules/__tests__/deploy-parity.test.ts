// Deploy parity regression test — asserts that after a build, the
// served bundle matches the local bundle. Catches the class of bug where
// pm2 restart happens mid-build, serving a stale bundle.
import { describe, it, expect } from 'vitest'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const BASE = process.env.TEST_BASE_URL || 'http://localhost:4400'
const DEPLOY_ORIGIN = (process.env.DEPLOY_ORIGIN || BASE).replace(/\/$/, '')

function md5Hex(buf: Buffer): string {
  let h = 5381
  for (let i = 0; i < buf.length; i++) h = ((h << 5) + h + buf[i]) | 0
  return (h >>> 0).toString(16).padStart(8, '0')
}

function joinUrl(origin: string, chunk: string): string {
  return chunk.startsWith('/') ? `${origin}${chunk}` : `${origin}/${chunk}`
}

describe('Deploy Parity', () => {
  it('served chunk matches freshly built chunk', async () => {
    execSync('npx next build --turbopack', { cwd: process.cwd(), stdio: 'pipe', timeout: 600_000 })

    const homeHtml = await fetch(`${DEPLOY_ORIGIN}/`).then((r) => r.text())
    const chunkMatch = homeHtml.match(/_next\/static\/chunks\/[^"]+\.js/)?.[0]
    expect(chunkMatch, 'found a chunk reference').toBeTruthy()

    const localPath = path.join('.next/static/chunks', path.basename(chunkMatch!))
    const local = fs.readFileSync(localPath)
    const servedRes = await fetch(joinUrl(DEPLOY_ORIGIN, chunkMatch!))
    const servedArr = new Uint8Array(await servedRes.arrayBuffer())
    const served = Buffer.from(servedArr)

    expect(md5Hex(served)).toBe(md5Hex(local))
  }, 600_000)
})
