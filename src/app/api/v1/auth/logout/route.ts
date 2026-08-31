export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { clearRefreshCookie } from '@/lib/jwt';

/**
 * POST /api/v1/auth/logout
 * Clear session cookie and log user out
 */
export async function POST(_request: NextRequest) {
  try {
    // Clear session cookie
    const cookieStore = await cookies();
    cookieStore.delete('nexus-session');

    const response = NextResponse.json(
      {
        success: true,
        message: 'Logged out successfully',
      },
      { status: 200 }
    );

    // Also clear the refresh token cookie (path-scoped to /api/v1/auth/refresh)
    response.headers.append('Set-Cookie', clearRefreshCookie());

    return response;
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to logout' 
      },
      { status: 500 }
    );
  }
}
