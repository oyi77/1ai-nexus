export const runtime = 'nodejs';

// ─────────────────────────────────────────────────────────────
// POST /api/v1/auth/reset — Complete password reset.
// Requires a purpose-scoped token (purpose=password-reset) from the
// email link, plus the new password. Verifies the token purpose and
// expiry, then updates the password hash.
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { verifyPurposeToken } from '@/lib/jwt';
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

    // Enforce password strength.
    const strength = validatePasswordStrength(password);
    if (!strength.valid) {
      return NextResponse.json(
        { error: strength.errors.join('; ') },
        { status: 400 }
      );
    }

    // Update the password hash.
    const passwordHash = await hashPassword(password);
    await prisma.user.update({
      where: { id: payload.userId },
      data: { passwordHash },
    });

    return NextResponse.json({ message: 'Password updated. You can now sign in.' }, { status: 200 });
  } catch (error) {
    console.error('Reset password error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}