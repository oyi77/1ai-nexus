import { type NextRequest } from 'next/server'
import { apiJson, apiError } from '@/lib/api/response'
import { verifyToken } from '@/lib/jwt'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// ─────────────────────────────────────────────────────────────
// GET /api/v1/admin/stats — Admin-only platform stats overview
// Returns total users, active API keys, and plan distribution.
// ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  let token: string | undefined
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7)
  } else {
    token = request.cookies.get('nexus-session')?.value
  }
  if (!token) return apiError('Authentication required', 401)

  const payload = await verifyToken(token)
  if (!payload?.userId) return apiError('Invalid or expired token', 401)
  const userId = payload.userId

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    })
    if (!user || user.role !== 'admin') return apiError('Forbidden', 403)

    const [users, activeKeys, planGroups] = await Promise.all([
      prisma.user.count(),
      prisma.userApiKey.count({ where: { isActive: true } }),
      prisma.user.groupBy({ by: ['plan'], _count: true }),
    ])

    const plans: { free: number; pro: number; enterprise: number } = {
      free: 0,
      pro: 0,
      enterprise: 0,
    }
    for (const group of planGroups) {
      plans[group.plan] = group._count
    }

    return apiJson({ users, activeKeys, plans })
  } catch (err) {
    console.error('Admin stats fetch error:', err)
    return apiError('Failed to fetch stats', 500)
  }
}
