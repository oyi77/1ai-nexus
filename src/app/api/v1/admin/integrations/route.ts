// -------------------------------------------------------------
// /api/v1/admin/integrations - Admin-managed integration secrets.
//
// GET  list integrations: [{ key, label, updatedAt, healthy }]
// POST stage a secret: { key, value } — validates BEFORE saving:
//      JWT 3-segment shape, then a live refresh probe. Validation
//      spends one upstream rotation, so success SAVES the rotated
//      pair atomically (see docs/product/03-tech-secrets.md).
//
// Auth: admin only (requireAdmin). Non-admin → identical 403.
// Values are NEVER echoed, logged, or returned.
// -------------------------------------------------------------
import { type NextRequest } from 'next/server'
import { apiJson, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/admin-auth'
import { prisma } from '@/lib/db'
import { writeSecret } from '@/lib/secrets'
import { refreshStockbitSession, redactJwt } from '@/lib/modules/market/provider/idx-stockbit/session'

export const dynamic = 'force-dynamic'

const STOCKBIT_RT_KEY = 'stockbit_refresh_token'

const INTEGRATIONS = [
  { key: STOCKBIT_RT_KEY, label: 'Stockbit refresh token' },
] as const

const VALID_KEYS = new Set<string>(INTEGRATIONS.map((i) => i.key))

const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

export async function GET(request: NextRequest) {
  if (!(await requireAdmin(request))) return apiError('Forbidden', 403)
  try {
    const rows = await prisma.integrationSecret.findMany({
      where: { key: { in: [...VALID_KEYS] } },
      select: { key: true, updatedAt: true },
    })
    const byKey = new Map(rows.map((r) => [r.key, r.updatedAt]))
    const items = INTEGRATIONS.map((i) => ({
      key: i.key,
      label: i.label,
      staged: byKey.has(i.key),
      updatedAt: byKey.get(i.key)?.toISOString() ?? null,
      healthy: byKey.has(i.key), // value-presence health; deep validity proven by harvest rows
    }))
    return apiJson({ items })
  } catch (err) {
    return apiError(redactJwt(err instanceof Error ? err.message : String(err)), 500)
  }
}

interface StageBody {
  key?: unknown
  value?: unknown
}

export async function POST(request: NextRequest) {
  if (!(await requireAdmin(request))) return apiError('Forbidden', 403)
  let body: StageBody
  try {
    body = (await request.json()) as StageBody
  } catch {
    return apiError('Invalid JSON body', 400)
  }
  if (typeof body.key !== 'string' || !VALID_KEYS.has(body.key)) {
    return apiError('Unknown integration key', 400)
  }
  const candidate = typeof body.value === 'string' ? body.value.trim() : ''
  if (!JWT_RE.test(candidate)) {
    return apiError('Value must be a JWT (three base64url segments)', 400)
  }
  if (body.key === STOCKBIT_RT_KEY) {
    // Live probe: refresh spends one rotation — save the ROTATED pair.
    try {
      const fresh = await refreshStockbitSession(candidate)
      await writeSecret(STOCKBIT_RT_KEY, fresh.refreshToken)
      return apiJson({ ok: true, key: STOCKBIT_RT_KEY, updatedAt: new Date().toISOString() })
    } catch (err) {
      return apiError(
        `Token rejected by Stockbit (nothing saved). Cause: ${redactJwt(err instanceof Error ? err.message : String(err))}`,
        502,
      )
    }
  }
  return apiError('Unknown integration key', 400)
}

export async function DELETE(request: NextRequest) {
  if (!(await requireAdmin(request))) return apiError('Forbidden', 403)
  const key = new URL(request.url).searchParams.get('key') ?? ''
  if (!VALID_KEYS.has(key)) return apiError('Unknown integration key', 400)
  try {
    await prisma.integrationSecret.deleteMany({ where: { key } })
    return apiJson({ ok: true, key })
  } catch (err) {
    return apiError(redactJwt(err instanceof Error ? err.message : String(err)), 500)
  }
}

