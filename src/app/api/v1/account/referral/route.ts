import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyToken } from '@/lib/jwt'

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '')
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const payload = await verifyToken(token)
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        referralCode: true,
        referralsCount: true,
        referralCredits: true,
        referredById: true,
      },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({
      data: {
        referralCode: user.referralCode,
        referralsCount: user.referralsCount,
        credits: user.referralCredits,
        referredBy: user.referredById,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch referral stats' }, { status: 500 })
  }
}
