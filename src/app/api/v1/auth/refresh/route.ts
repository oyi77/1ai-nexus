export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyToken, signToken, generateRefreshToken, createRefreshCookie, extractRefreshToken } from '@/lib/jwt';
import { prisma } from '@/lib/db';

/**
 * POST /api/v1/auth/refresh
 * Refresh JWT access token using refresh token
 */
export async function POST(request: NextRequest) {
  try {
    // Try to get refresh token from cookie first, fallback to body
    const cookieHeader = request.headers.get('cookie');
    let refreshToken = extractRefreshToken(cookieHeader);
    
    // If not in cookie, try body
    if (!refreshToken) {
      const body = await request.json();
      refreshToken = body.refreshToken;
    }

    if (!refreshToken || typeof refreshToken !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Refresh token required' },
        { status: 400 }
      );
    }

    // Verify refresh token
    const decoded = await verifyToken(refreshToken);
    if (!decoded) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired refresh token' },
        { status: 401 }
      );
    }

    // Fetch latest user data
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        role: true,
        plan: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    // Generate new tokens
    const accessToken = await signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      plan: user.plan,
    });

    const newRefreshToken = await generateRefreshToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      plan: user.plan,
    });

    // Create response with new tokens
    const response = NextResponse.json({
      success: true,
      accessToken,
      refreshToken: newRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        plan: user.plan,
      },
    });

    // Set new session cookie
    response.cookies.set('nexus-session', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    });

    // Set new refresh token cookie
    const refreshCookie = createRefreshCookie(newRefreshToken);
    response.headers.append('Set-Cookie', refreshCookie);

    return response;
  } catch (error) {
    console.error('Token refresh error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to refresh token' },
      { status: 500 }
    );
  }
}
