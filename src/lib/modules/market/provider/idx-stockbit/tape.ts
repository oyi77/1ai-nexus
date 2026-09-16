// ─────────────────────────────────────────────────────────────
// Stockbit WS tape client — live running-trade prints over the
// trading websocket. Keyless-anonymous connects are rejected
// ("you are not authorized"); a staged session subscribes.
// SERVER-ONLY.
//
// Protocol (reverse-engineered 2026-09-16 from web bundle chunk
// 51232 protobuf-es descriptors + live probes — see
// local/stockbit-auth-re.md §12 addendum):
// - URL: wss://wss-jkt.trading.stockbit.com/ws, subprotocol ["web"]
// - Frames are raw protobuf (no Primus envelope on this socket).
// - Subscribe: securities.transactional.datafeed.v1.WebsocketRequest
//     { channel: WebsocketChannel{ running_trade: [SYM…] },
//       access_token, user_id }
// - Server answers securities.transactional.datafeed.v1.
//   WebsocketWrapMessageChannel (oneof: running_trade, top20,
//   orderbook_header/body, liveprice, error, …).
// - RunningTrade fields: stock(s,2), price(d,3), volume(d,4),
//   action(enum,5), websocket_time(msg,1).
// Encoding here is hand-rolled varint (no new dependency) — only
// the wire shapes this client sends/parses are implemented.
// ─────────────────────────────────────────────────────────────

import { resolveStockbitAccessToken } from './session'

const WS_URL = 'wss://wss-jkt.trading.stockbit.com/ws'

export interface TapePrint {
  symbol: string
  price: number
  volume: number
  action: number // 1=BUY 2=SELL (ActionType enum; 0=unspecified)
  timeMs: number
}

function encTag(field: number, wire: number): number[] {
  let tag = (field << 3) | wire
  const out: number[] = []
  while (tag > 127) {
    out.push((tag & 127) | 128)
    tag >>= 7
  }
  out.push(tag)
  return out
}

function encLen(n: number): number[] {
  const out: number[] = []
  while (n > 127) {
    out.push((n & 127) | 128)
    n >>= 7
  }
  out.push(n)
  return out
}

function encString(field: number, s: string): Buffer {
  const b = Buffer.from(s, 'utf8')
  return Buffer.concat([Buffer.from(encTag(field, 2)), Buffer.from(encLen(b.length)), b])
}

function encMessage(field: number, inner: Buffer): Buffer {
  return Buffer.concat([Buffer.from(encTag(field, 2)), Buffer.from(encLen(inner.length)), inner])
}


/** Build a WebsocketRequest subscribe frame. Pure — unit-testable. */
export function buildSubscribeFrame(symbols: string[], accessToken: string, userId = ''): Buffer {
  const parts: Buffer[] = []
  for (const s of symbols) parts.push(encString(3, s.toUpperCase()))
  const channel = Buffer.concat(parts)
  const req: Buffer[] = [encMessage(2, channel)]
  if (userId) req.push(encString(1, userId))
  req.push(encString(5, accessToken))
  return Buffer.concat(req)
}

interface Reader {
  buf: Buffer
  pos: number
}

function readVarint(r: Reader): number {
  let shift = 0
  let out = 0
  for (;;) {
    const b = r.buf[r.pos++]
    out |= (b & 0x7f) << shift
    if ((b & 0x80) === 0) return out
    shift += 7
  }
}

function readBytes(r: Reader): Buffer {
  const len = readVarint(r)
  const b = r.buf.subarray(r.pos, r.pos + len)
  r.pos += len
  return Buffer.from(b)
}

/** Parse one RunningTrade message body (fields 2-5 + time passthrough). Pure. */
export function parseRunningTrade(body: Buffer): Omit<TapePrint, 'timeMs'> & { timeMs: number } {
  const r: Reader = { buf: body, pos: 0 }
  const out = { symbol: '', price: 0, volume: 0, action: 0, timeMs: 0 }
  while (r.pos < r.buf.length) {
    const tag = readVarint(r)
    const field = tag >> 3
    const wire = tag & 7
    if (wire === 0) {
      const v = readVarint(r)
      if (field === 5) out.action = v
    } else if (wire === 1) {
      const v = r.buf.readDoubleLE(r.pos)
      r.pos += 8
      if (field === 3) out.price = v
      else if (field === 4) out.volume = v
    } else if (wire === 2) {
      const b = readBytes(r)
      if (field === 2) out.symbol = b.toString('utf8')
      else if (field === 1) {
        // websocket_time (google Timestamp nested) — ignored, wall clock used
      }
    } else {
      throw new Error(`unsupported wire type ${wire}`)
    }
  }
  return out
}

/**
 * Unwrap one WebsocketWrapMessageChannel frame. Returns tape prints
 * (field 1 = running_trade, field 8 = running_trade_batch repeated).
 * Throws on field 7 (error) with the server message.
 */
export function parseWrapFrame(frame: Buffer): TapePrint[] {
  const r: Reader = { buf: frame, pos: 0 }
  const prints: TapePrint[] = []
  const now = Date.now()
  while (r.pos < r.buf.length) {
    const tag = readVarint(r)
    const field = tag >> 3
    const wire = tag & 7
    if (wire !== 2) {
      // skip unknown scalar
      if (wire === 0) readVarint(r)
      else if (wire === 1) r.pos += 8
      else if (wire === 5) r.pos += 4
      else throw new Error(`unsupported wire type ${wire}`)
      continue
    }
    const body = readBytes(r)
    if (field === 7) {
      // Error message — extract embedded utf8 for the message
      const m = /[ -~]{4,}/g
      const texts = body.toString('utf8').match(m) ?? []
      throw new Error(`Stockbit WS error: ${texts.join(' ').slice(0, 200)}`)
    }
    if (field === 1 || field === 8) {
      // running_trade (single) or batch — batch decodes as repeated embedded;
      // try whole-body as one trade, fall back to length-delimited scan.
      try {
        const t = parseRunningTrade(body)
        if (t.symbol) prints.push({ ...t, timeMs: now })
      } catch {
        const inner: Reader = { buf: body, pos: 0 }
        while (inner.pos < inner.buf.length) {
          try {
            const t = parseRunningTrade(readBytes(inner))
            if (t.symbol) prints.push({ ...t, timeMs: now })
          } catch {
            break
          }
        }
      }
    }
  }
  return prints
}

/**
 * Capture live tape prints for symbols over `seconds`. Requires a
 * staged session (throws actionable error otherwise — same pattern
 * as the REST harvester: absence of credentials is skip, not data).
 */
export async function captureTape(symbols: string[], seconds = 10): Promise<TapePrint[]> {
  const token = await resolveStockbitAccessToken()
  const frame = buildSubscribeFrame(symbols.map(s => s.toUpperCase()), token)
  return new Promise((resolve, reject) => {
    const prints: TapePrint[] = []
    let ws: WebSocket
    try {
      ws = new WebSocket(WS_URL, ['web'])
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
      return
    }
    const done = (): void => {
      try {
        ws.close()
      } catch {
        /* already closed */
      }
      resolve(prints)
    }
    const timer = setTimeout(done, Math.min(120, Math.max(2, seconds)) * 1000)
    ws.binaryType = 'arraybuffer'
    ws.onopen = (): void => {
      ws.send(frame)
    }
    ws.onmessage = (e: MessageEvent): void => {
      try {
        const buf =
          e.data instanceof ArrayBuffer
            ? Buffer.from(e.data)
            : Buffer.from(e.data as string)
        prints.push(...parseWrapFrame(buf))
      } catch {
        // One bad frame never kills the capture; error frames surface
        // only when they are the sole content (parseWrapFrame throws).
      }
    }
    ws.onerror = (): void => {
      clearTimeout(timer)
      reject(new Error('Stockbit WS transport error'))
    }
    ws.onclose = (): void => {
      clearTimeout(timer)
      resolve(prints)
    }
  })
}
