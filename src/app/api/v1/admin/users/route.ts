import { type NextRequest } from 'next/server'
import { apiJson, apiError } from '@/lib/api/response'
import { verifyToken } from '@/lib/jwt'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// ─────────────────────────────────────────────────────────────
// GET /api/v1/admin/users — Admin-only user directory
// Returns the 50 most-recent users (id, email, plan, createdAt).
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

    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        email: true,
        plan: true,
        createdAt: true,
      },
    })

    return apiJson({ users })
  } catch (err) {
    console.error('Admin users fetch error:', err)
    return apiError('Failed to fetch users', 500)
  }
}
