// ─────────────────────────────────────────────────────────────
// GET /api/v1/conviction/stream — server-sent events (SSE)
// Pushes a fresh conviction result every STREAM_INTERVAL_MS so the
// client gets LIVE updates instead of 60s polling.
// Public (ALWAYS_PUBLIC) — same trust model as the poll route.
// ─────────────────────────────────────────────────────────────

import { getCachedConvictionResult } from '@/lib/conviction/build'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STREAM_INTERVAL_MS = 30_000 // recompute every 30s
const HEARTBEAT_MS = 10_000

export async function GET() {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      // Guard: once true, no enqueue is attempted. Set FIRST in cleanup
      // so any in-flight push that resolves after disconnect sees it.
      let closed = false

      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return
        try {
          controller.enqueue(chunk)
        } catch {
          // Controller already closed (client disconnected mid-push).
          // Flip the flag so subsequent pushes are skipped too.
          closed = true
        }
      }

      // Immediate first payload so the client renders fast.
      const push = async () => {
        if (closed) return
        try {
          const result = await getCachedConvictionResult()
          const frame = `data: ${JSON.stringify({ data: result, meta: null, error: null })}\n\n`
          safeEnqueue(encoder.encode(frame))
        } catch {
          // Enqueue a graceful empty so the client isn't left hanging.
          const frame = `data: ${JSON.stringify({ data: null, meta: null, error: 'stream_error' })}\n\n`
          safeEnqueue(encoder.encode(frame))
        }
      }
      await push()

      const interval = setInterval(() => void push(), STREAM_INTERVAL_MS)
      const heartbeat = setInterval(() => {
        // SSE keep-alive — some proxies close idle connections.
        safeEnqueue(encoder.encode(`: ping ${Date.now()}\n\n`))
      }, HEARTBEAT_MS)

      // Clean up timers when the client disconnects.
      const cleanup = () => {
        closed = true
        clearInterval(interval)
        clearInterval(heartbeat)
        try { controller.close() } catch { /* already closed */ }
      }
      // @ts-expect-error request cancellation isn't typed on ReadableStream
      if (controller.signal) controller.signal.addEventListener('abort', cleanup)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
