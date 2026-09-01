// ─────────────────────────────────────────────────────────────
// GET /api/v1/conviction — Decision Layer (poll variant)
// Single source of truth: delegates to the shared producer.
// Public endpoint (middleware ALWAYS_PUBLIC).
// ─────────────────────────────────────────────────────────────

import { apiJson } from '@/lib/api/response'
import { getCachedConvictionResult } from '@/lib/conviction/build'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const result = await getCachedConvictionResult()
  const resp = apiJson(result)
  resp.headers.set('Cache-Control', 'public, max-age=30')
  if ((result as { stale?: boolean }).stale) {
    resp.headers.set('X-Conviction-Stale', 'true')
  }
  return resp
}
