// ─────────────────────────────────────────────────────────────
// GET /api/v1/conviction — Decision Layer (poll variant)
// Single source of truth: delegates to the shared producer.
// Public endpoint (middleware ALWAYS_PUBLIC).
// ─────────────────────────────────────────────────────────────

import { apiJson } from '@/lib/api/response'
import { safeBuildConvictionResult } from '@/lib/conviction/build'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const resp = apiJson(await safeBuildConvictionResult())
  resp.headers.set('Cache-Control', 'public, max-age=30')
  return resp
}
