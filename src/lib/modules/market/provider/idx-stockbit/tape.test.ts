// ─────────────────────────────────────────────────────────────
// WS tape client tests — pure framing (encode/decode), zero network.
// Live proofs recorded 2026-09-16 (see header of tape.ts):
// - subscribe frame (no token) → server parses → field-7 error
//   "you are not authorized"
// - same + invalid token → identical authorized-path rejection
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { buildSubscribeFrame, parseRunningTrade, parseWrapFrame } from './tape'

function encString(field: number, s: string): Buffer {
  const b = Buffer.from(s, 'utf8')
  const tag = (field << 3) | 2
  return Buffer.concat([Buffer.from([tag, b.length]), b])
}

function encDouble(field: number, v: number): Buffer {
  const b = Buffer.alloc(8)
  b.writeDoubleLE(v, 0)
  return Buffer.concat([Buffer.from([(field << 3) | 1]), b])
}

function encVarint(field: number, v: number): Buffer {
  return Buffer.from([(field << 3) | 0, v])
}

describe('buildSubscribeFrame', () => {
  it('encodes the live-probed byte shape', () => {
    const frame = buildSubscribeFrame(['BBRI'], '')
    // channel{running_trade:"BBRI"} with EMPTY token field present:
    // 12 06 1a 04 "BBRI" 2a 00
    expect(frame.toString('hex')).toBe('12061a04424252492a00')
  })

  it('appends user_id + access_token when given', () => {
    const frame = buildSubscribeFrame(['BBRI'], 'TOK', 'UID')
    const hex = frame.toString('hex')
    expect(hex).toContain(Buffer.from('UID').toString('hex'))
    expect(hex).toContain(Buffer.from('TOK').toString('hex'))
    // field order: channel(2) … user_id(1) … token(5) — token last
    expect(hex.indexOf(Buffer.from('TOK').toString('hex'))).toBeGreaterThan(
      hex.indexOf(Buffer.from('BBRI').toString('hex')),
    )
  })

  it('uppercases symbols and packs several', () => {
    const frame = buildSubscribeFrame(['bbri', 'tlkm'], 'T')
    const hex = frame.toString('hex')
    expect(hex).toContain(Buffer.from('BBRI').toString('hex'))
    expect(hex).toContain(Buffer.from('TLKM').toString('hex'))
  })
})

describe('parseRunningTrade', () => {
  it('decodes a synthetic print', () => {
    const body = Buffer.concat([
      encString(2, 'BBRI'),
      encDouble(3, 3330),
      encDouble(4, 150),
      encVarint(5, 1),
    ])
    const t = parseRunningTrade(body)
    expect(t).toMatchObject({ symbol: 'BBRI', price: 3330, volume: 150, action: 1 })
  })
})

describe('parseWrapFrame', () => {
  it('unwraps field-1 running_trade', () => {
    const trade = Buffer.concat([encString(2, 'BBRI'), encDouble(3, 3330)])
    const frame = Buffer.concat([Buffer.from([0x0a, trade.length]), trade])
    const prints = parseWrapFrame(frame)
    expect(prints).toHaveLength(1)
    expect(prints[0]).toMatchObject({ symbol: 'BBRI', price: 3330 })
  })

  it('throws the server message on field-7 error', () => {
    const body = Buffer.concat([encVarint(1, 401), encString(2, 'you are not authorized')])
    const frame = Buffer.concat([Buffer.from([0x3a, body.length]), body])
    expect(() => parseWrapFrame(frame)).toThrow(/not authorized/)
  })
})
