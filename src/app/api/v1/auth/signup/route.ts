import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { hashPassword, validatePasswordStrength } from '@/lib/password';
import { signToken, generateRefreshToken, createRefreshCookie, createSessionCookie } from '@/lib/jwt';

const signupSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

export async function POST(request: NextRequest) {
  try {
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

    // Create user with default free plan
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        role: 'free',
        plan: 'free',
      },
      select: {
        id: true,
        email: true,
        role: true,
        plan: true,
        createdAt: true,
      },
    });

    // Generate JWT tokens
    const accessToken = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      plan: user.plan,
    });

    const refreshToken = generateRefreshToken({
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
