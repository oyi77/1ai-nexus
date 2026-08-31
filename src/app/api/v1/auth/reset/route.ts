export const runtime = 'nodejs';

// ─────────────────────────────────────────────────────────────
// POST /api/v1/auth/reset — Complete password reset.
// Requires a purpose-scoped token (purpose=password-reset) from the
// email link, plus the new password. Verifies the token purpose and
// expiry, then updates the password hash atomically with the
// passwordResetUsedAt timestamp, making the link single-use.
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { verifyPurposeToken, clearSessionCookie, clearRefreshCookie } from '@/lib/jwt';
import { hashPassword, validatePasswordStrength } from '@/lib/password';

const resetSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  password: z.string().min(1, 'Password is required'),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = resetSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }

    const { token, password } = parsed.data;

    // Token must carry purpose=password-reset and be unexpired.
    const payload = await verifyPurposeToken(token, 'password-reset');
    if (!payload?.userId) {
      return NextResponse.json(
        { error: 'Invalid or expired reset link. Request a new one.' },
        { status: 400 }
      );
    }

    // Check the token hasn't already been consumed (single-use).
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { passwordResetUsedAt: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (user.passwordResetUsedAt) {
      return NextResponse.json(
        { error: 'Reset link already used. Request a new one.' },
        { status: 400 }
      );
    }

    // Enforce password strength.
    const strength = validatePasswordStrength(password);
    if (!strength.valid) {
      return NextResponse.json(
        { error: strength.errors.join('; ') },
        { status: 400 }
      );
    }

    // Atomic update: set passwordHash AND passwordResetUsedAt, but only if
    // passwordResetUsedAt is still null (prevents a race replay).
    const passwordHash = await hashPassword(password);
    const result = await prisma.user.updateMany({
      where: { id: payload.userId, passwordResetUsedAt: null },
      data: { passwordHash, passwordResetUsedAt: new Date() },
    });

    if (result.count === 0) {
      // Another request already consumed this reset link (race).
      return NextResponse.json(
        { error: 'Reset link already used. Request a new one.' },
        { status: 400 }
      );
    }

    // Clear session cookies so old JWTs are evicted from the browser.
    // (Existing JWTs remain technically valid until expiry — a documented
    //  tradeoff; the user must sign in again with their new password.)
    const response = NextResponse.json(
      { message: 'Password updated. You can now sign in.' },
      { status: 200 }
    );
    response.headers.append('Set-Cookie', clearSessionCookie());
    response.headers.append('Set-Cookie', clearRefreshCookie());
    return response;
  } catch (error) {
    console.error('Reset password error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}