// ─────────────────────────────────────────────────────────────
// Admin route guard — JWT from Bearer header or session cookie,
// then role check. Returns null when the caller is not an admin.
// ─────────────────────────────────────────────────────────────
import { type NextRequest } from 'next/server'
import { verifyToken } from '@/lib/jwt'
import { prisma } from '@/lib/db'

export async function requireAdmin(
  request: NextRequest
): Promise<{ userId: string } | null> {
  let token: string | undefined
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7)
  } else {
    token = request.cookies.get('nexus-session')?.value
  }
  if (!token) return null

  const payload = await verifyToken(token)
  if (!payload?.userId) return null

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { role: true },
  })
  if (!user || user.role !== 'admin') return null
  return { userId: payload.userId }
}
