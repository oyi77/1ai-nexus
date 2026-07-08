import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from '@/app/api/v1/auth/login/route';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { UserRole, type User } from '@prisma/client';

// Mock JWT functions
vi.mock('@/lib/jwt', () => ({
  signToken: vi.fn((payload: unknown) => 'mock-jwt-token'),
  createSessionCookie: vi.fn((token: string) => `nexus-session=${token}; HttpOnly; Secure; Path=/`),
}));

describe('POST /api/v1/auth/login', () => {
  const testEmail = 'test-login-user@example.com';
  let testUser: User;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Clean up any existing test users
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'test-login-' } },
    });

    // Create test user with hashed password
    const passwordHash = await hashPassword('SecurePass123');
    testUser = await prisma.user.create({
      data: {
        email: testEmail,
        passwordHash,
        role: UserRole.free,
        plan: 'free',
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'test-login-' } },
    });
    await prisma.$disconnect();
  });

  describe('Success Cases', () => {
    it('should login user with valid credentials', async () => {
      const request = new Request('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testEmail,
          password: 'SecurePass123',
        }),
      }) as NextRequest;

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('user');
      expect(data).toHaveProperty('message', 'Logged in successfully');
      expect(data.user).toMatchObject({
        id: testUser.id,
        email: testUser.email,
        role: testUser.role,
        plan: testUser.plan,
      });
      expect(response.headers.get('Set-Cookie')).toContain('nexus-session=');
    });

    it('should not return passwordHash in response', async () => {
      const request = new Request('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testEmail,
          password: 'SecurePass123',
        }),
      }) as NextRequest;

      const response = await POST(request);
      const data = await response.json();

      expect(data.user).not.toHaveProperty('passwordHash');
    });

    it('should set HttpOnly session cookie', async () => {
      const request = new Request('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testEmail,
          password: 'SecurePass123',
        }),
      }) as NextRequest;

      const response = await POST(request);
      const setCookie = response.headers.get('Set-Cookie');

      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('Secure');
      expect(setCookie).toContain('Path=/');
    });
  });

  describe('Validation Errors', () => {
    it('should reject request with invalid email format', async () => {
      const request = new Request('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'invalid-email',
          password: 'SecurePass123',
        }),
      }) as NextRequest;

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toHaveProperty('error', 'Invalid input');
      expect(data).toHaveProperty('details');
      expect(Array.isArray(data.details)).toBe(true);
    });

    it('should reject request with missing email', async () => {
      const request = new Request('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: 'SecurePass123',
        }),
      }) as NextRequest;

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toHaveProperty('error', 'Invalid input');
    });

    it('should reject request with missing password', async () => {
      const request = new Request('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testEmail,
        }),
      }) as NextRequest;

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toHaveProperty('error', 'Invalid input');
    });

    it('should reject request with empty password', async () => {
      const request = new Request('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testEmail,
          password: '',
        }),
      }) as NextRequest;

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toHaveProperty('error', 'Invalid input');
    });
  });

  describe('Authentication Errors', () => {
    it('should reject login with non-existent email', async () => {
      const request = new Request('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'nonexistent@example.com',
          password: 'SecurePass123',
        }),
      }) as NextRequest;

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toHaveProperty('error', 'Invalid email or password');
    });

    it('should reject login with incorrect password', async () => {
      const request = new Request('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testEmail,
          password: 'WrongPassword123',
        }),
      }) as NextRequest;

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toHaveProperty('error', 'Invalid email or password');
    });

    it('should reject login for user without password hash', async () => {
      // Create user without password
      const noPasswordEmail = 'test-login-nopass@example.com';
      await prisma.user.create({
        data: {
          email: noPasswordEmail,
          passwordHash: null,
          role: UserRole.free,
          plan: 'free',
        },
      });

      const request = new Request('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: noPasswordEmail,
          password: 'AnyPassword123',
        }),
      }) as NextRequest;

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toHaveProperty('error', 'Invalid email or password');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid JSON body', async () => {
      const request = new Request('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid-json',
      }) as NextRequest;

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toHaveProperty('error', 'Internal server error');
    });
  });

  describe('Response Format', () => {
    it('should return JSON with correct content-type', async () => {
      const request = new Request('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testEmail,
          password: 'SecurePass123',
        }),
      }) as NextRequest;

      const response = await POST(request);

      expect(response.headers.get('content-type')).toContain('application/json');
    });
  });
});
