export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { hashPassword, validatePasswordStrength } from '@/lib/password';
import { signToken, generateRefreshToken, createRefreshCookie, createSessionCookie } from '@/lib/jwt';
import { checkRateLimit } from '@/lib/api/rate-limit';
import { generateReferralCode } from '@/lib/referral';

const signupSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
  referralCode: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    // Rate limit: 5 signups per 15 min per IP (abuse + bcrypt CPU DoS guard).
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0].trim() : (request.headers.get('x-real-ip') ?? 'unknown');
    const { allowed } = await checkRateLimit(`auth:signup:${ip}`, 5, 900_000);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many signups, please try again later.' }, { status: 429 });
    }

    const body = await request.json();
    const parsed = signupSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { email, password } = parsed.data;

    // Validate password strength
    const passwordValidation = validatePasswordStrength(password);
    if (!passwordValidation.valid) {
      return NextResponse.json(
        { error: 'Weak password', details: passwordValidation.errors },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: 'Email already registered' },
        { status: 409 }
      );
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user with default free plan + referral code
    const referralCode = generateReferralCode()
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        role: 'free',
        plan: 'free',
        referralCode,
      },
      select: {
        id: true,
        email: true,
        role: true,
        plan: true,
        createdAt: true,
        referralCode: true,
      },
    });

    // Process referral if code provided
    if (parsed.data.referralCode) {
      const referrer = await prisma.user.findUnique({
        where: { referralCode: parsed.data.referralCode },
      })
      if (referrer && referrer.id !== user.id) {
        await prisma.user.update({
          where: { id: referrer.id },
          data: {
            referralsCount: { increment: 1 },
            referralCredits: { increment: 1 },
          },
        })
        await prisma.user.update({
          where: { id: user.id },
          data: { referredById: referrer.id },
        })
      }
    }

    // If SMTP is not configured, auto-verify (dev convenience only —
    // production must verify via /api/v1/auth/verify to prevent spam accounts).
    const smtpConfigured = Boolean(process.env.MAIL_HOST && process.env.MAIL_USER && process.env.MAIL_PASS)
    if (!smtpConfigured && process.env.NODE_ENV !== 'production') {
      await prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: new Date() },
      });
    }

    // Generate JWT tokens
    const accessToken = await signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      plan: user.plan,
    });

    const refreshToken = await generateRefreshToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      plan: user.plan,
    });

    // Create response with session cookie
    const response = NextResponse.json(
      {
        user,
        accessToken,
        refreshToken,
      },
      { status: 201 }
    );

    // Set HTTP-only session cookie
    const sessionCookie = createSessionCookie(accessToken);
    response.headers.set('Set-Cookie', sessionCookie);

    // Set HTTP-only refresh token cookie
    const refreshCookie = createRefreshCookie(refreshToken);
    response.headers.append('Set-Cookie', refreshCookie);

    return response;
  } catch (error) {
    console.error('Signup error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
