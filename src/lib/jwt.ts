import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { serialize, parse, type CookieSerializeOptions } from 'cookie';

const JWT_SECRET = process.env.NEXTAUTH_SECRET;
if (!JWT_SECRET) {
  throw new Error('NEXTAUTH_SECRET environment variable is required');
}

// Convert secret to Uint8Array for jose
const secretKey = new TextEncoder().encode(JWT_SECRET);

const JWT_EXPIRY = '7d'; // 7 days for access tokens
const REFRESH_TOKEN_EXPIRY = '30d'; // 30 days for refresh tokens
const COOKIE_NAME = 'nexus-session';
const REFRESH_COOKIE_NAME = 'nexus-refresh';

export interface JwtPayload extends JWTPayload {
  userId: string;
  email: string;
  role: string;
  plan: string;
}

/**
 * Convert expiry string to seconds
 */
function expiryToSeconds(expiry: string): number {
  const unit = expiry.slice(-1);
  const value = parseInt(expiry.slice(0, -1), 10);
  
  switch (unit) {
    case 'd': return value * 24 * 60 * 60;
    case 'h': return value * 60 * 60;
    case 'm': return value * 60;
    case 's': return value;
    default: throw new Error(`Invalid expiry format: ${expiry}`);
  }
}

/**
 * Sign a JWT token with user data
 */
export async function signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): Promise<string> {
  const jwt = new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY);
  return jwt.sign(secretKey);
}

/**
 * Verify and decode a JWT token
 */
export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey);
    return payload as JwtPayload;
  } catch (error) {
    console.error('JWT verification failed:', error);
    return null;
  }
}

/**
 * Generate a refresh token with longer expiry
 */
export async function generateRefreshToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): Promise<string> {
  const jwt = new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_EXPIRY);
  return jwt.sign(secretKey);
}

/**
 * Create HTTP-only session cookie
 */
export function createSessionCookie(token: string): string {
  const cookieOptions: CookieSerializeOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: expiryToSeconds(JWT_EXPIRY),
  };
  return serialize(COOKIE_NAME, token, cookieOptions);
}

/**
 * Create HTTP-only refresh token cookie
 */
export function createRefreshCookie(token: string): string {
  const cookieOptions: CookieSerializeOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/v1/auth/refresh',
    maxAge: expiryToSeconds(REFRESH_TOKEN_EXPIRY),
  };
  return serialize(REFRESH_COOKIE_NAME, token, cookieOptions);
}

/**
 * Clear refresh token cookie
 */
export function clearRefreshCookie(): string {
  const cookieOptions: CookieSerializeOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/v1/auth/refresh',
    maxAge: 0,
  };
  return serialize(REFRESH_COOKIE_NAME, '', cookieOptions);
}

/**
 * Create session deletion cookie (logout)
 */
export function clearSessionCookie(): string {
  const cookieOptions: CookieSerializeOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  };
  return serialize(COOKIE_NAME, '', cookieOptions);
}

/**
 * Extract token from request cookies
 */
export function extractTokenFromCookies(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const cookies = parse(cookieHeader);
  return cookies[COOKIE_NAME] || null;
}

/**
 * Extract refresh token from request cookies
 */
export function extractRefreshToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const cookies = parse(cookieHeader);
  return cookies[REFRESH_COOKIE_NAME] || null;
}

/**
 * Extract and verify token from request
 */
export async function extractAndVerifyToken(cookieHeader: string | null): Promise<JwtPayload | null> {
  const token = extractTokenFromCookies(cookieHeader);
  if (!token) return null;
  return verifyToken(token);
}
