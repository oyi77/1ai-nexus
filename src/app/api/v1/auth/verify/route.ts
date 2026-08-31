export const runtime = 'nodejs';

// ─────────────────────────────────────────────────────────────
// GET /api/v1/auth/verify?token=... — Verify email address via
// purpose-scoped JWT (purpose=email-verify). Idempotent: verifying
// an already-verified address returns success without re-writing.
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyPurposeToken } from '@/lib/jwt';

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get('token');
    if (!token) {
      return NextResponse.json({ error: 'Missing verification token' }, { status: 400 });
    }

    const payload = await verifyPurposeToken(token, 'email-verify');
    if (!payload?.userId) {
      return NextResponse.json({ error: 'Invalid or expired verification token' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (user.emailVerified) {
      return NextResponse.json({ message: 'Email already verified', verified: true });
    }

    await prisma.user.update({
      where: { id: payload.userId },
      data: { emailVerified: new Date() },
    });

    return NextResponse.json({ message: 'Email verified successfully', verified: true });
  } catch (error) {
    console.error('Email verification error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
