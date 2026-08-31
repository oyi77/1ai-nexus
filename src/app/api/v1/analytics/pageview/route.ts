export const runtime = 'nodejs'

import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// ─────────────────────────────────────────────────────────────
// POST /api/v1/analytics/pageview — Record a pageview
// Always public, no auth required. Returns 204 No Content.
// ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const path = typeof body.path === 'string' ? body.path.slice(0, 1024) : '/'
    const referrer = typeof body.referrer === 'string' ? body.referrer.slice(0, 2048) : null

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? request.headers.get('x-real-ip')
      ?? null
    const userAgent = request.headers.get('user-agent') ?? null

    await prisma.pageview.create({
      data: { path, referrer, ip, userAgent },
    })

    return new NextResponse(null, { status: 204 })
  } catch {
    return new NextResponse(null, { status: 204 })
  }
}