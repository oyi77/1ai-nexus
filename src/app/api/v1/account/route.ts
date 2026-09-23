// ─────────────────────────────────────────────────────────────
// DELETE /api/v1/account — Close your own account (GDPR Art. 17).
// Deletes profile, alerts, keys, watchlists, follows, badges, events,
// subscription + payments, then the user row. Privacy policy promises
// 30-day deletion — this does it immediately. Idempotent per JWT.
// ─────────────────────────────────────────────────────────────

import { type NextRequest } from 'next/server'
import { apiJson, apiError } from '@/lib/api/response'
import { verifyToken } from '@/lib/jwt'
import { prisma } from '@/lib/db'

export async function DELETE(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  let token: string | undefined
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
    // Order matters: children without cascade first, user row last.
    // Subscription cascades payments via FK; watchlist/papertrade cascade.
    await prisma.$transaction([
      prisma.alert.deleteMany({ where: { userId } }),
      prisma.follow.deleteMany({ where: { userId } }),
      prisma.moduleConfig.deleteMany({ where: { userId } }),
      prisma.userApiKey.deleteMany({ where: { userId } }),
      prisma.userBadge.deleteMany({ where: { userId } }),
      prisma.userEvent.deleteMany({ where: { userId } }),
      prisma.payment.deleteMany({ where: { subscription: { userId } } }),
      prisma.subscription.deleteMany({ where: { userId } }),
      prisma.watchlist.deleteMany({ where: { userId } }),
      prisma.paperTrade.deleteMany({ where: { userId } }),
      prisma.user.delete({ where: { id: userId } }),
    ])
    const resp = apiJson({ deleted: true })
    // Clear session cookies so the browser stops sending a dead identity.
    resp.cookies.set('nexus-session', '', { path: '/', maxAge: 0 })
    resp.cookies.set('nexus-refresh', '', { path: '/api/v1/auth/refresh', maxAge: 0 })
    return resp
  } catch {
    return apiError('Account deletion failed', 500)
  }
}
