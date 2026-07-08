import jwt from 'jsonwebtoken';
import { serialize, parse, type CookieSerializeOptions } from 'cookie';

const JWT_SECRET = process.env.NEXTAUTH_SECRET;
if (!JWT_SECRET) {
  throw new Error('NEXTAUTH_SECRET environment variable is required');
}

const JWT_EXPIRY = '7d'; // 7 days for access tokens
const REFRESH_TOKEN_EXPIRY = '30d'; // 30 days for refresh tokens
const COOKIE_NAME = 'nexus-session';
const REFRESH_COOKIE_NAME = 'nexus-refresh';

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  plan: string;
  iat?: number;
  exp?: number;
}

/**
 * Sign a JWT token with user data
 */
export function signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, JWT_SECRET!, { expiresIn: JWT_EXPIRY });
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET!) as JwtPayload;
  } catch (error) {
    return null;
  }
}

/**
 * Generate a refresh token with longer expiry
 */
export function generateRefreshToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, JWT_SECRET!, { expiresIn: REFRESH_TOKEN_EXPIRY });
}

/**
 * Create HTTP-only session cookie
 */
export function createSessionCookie(token: string): string {
  const isProduction = process.env.NODE_ENV === 'production';
  
  const cookieOptions: CookieSerializeOptions = {
    httpOnly: true,
    secure: isProduction, // HTTPS-only in production
    sameSite: 'strict',
    maxAge: 60 * 60 * 24 * 7, // 7 days in seconds
    path: '/',
  };

  return serialize(COOKIE_NAME, token, cookieOptions);
}

/**
 * Create HTTP-only refresh token cookie
 */
export function createRefreshCookie(token: string): string {
  const cookie = [
    `nexus-refresh=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${30 * 24 * 60 * 60}`, // 30 days
    process.env.NODE_ENV === 'production' ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');

  return cookie;
}

/**
 * Clear refresh token cookie
 */
export function clearRefreshCookie(): string {
  const cookieOptions: CookieSerializeOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 0,
    path: '/api/v1/auth/refresh',
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
    maxAge: 0, // Immediate expiry
    path: '/',
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
export function extractAndVerifyToken(cookieHeader: string | null): JwtPayload | null {
  const token = extractTokenFromCookies(cookieHeader);
  if (!token) return null;
  
  return verifyToken(token);
}
