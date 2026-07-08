import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { POST } from '@/app/api/v1/auth/signup/route';
import { prisma } from '@/lib/db';
import { NextRequest } from 'next/server';

// Mock jsonwebtoken before any imports that use it
vi.mock('jsonwebtoken', () => ({
  sign: vi.fn(() => 'mock-access-token'),
  default: {
    sign: vi.fn(() => 'mock-access-token'),
  },
}));

// Mock bcryptjs before any imports that use it
vi.mock('bcryptjs', () => ({
  hash: vi.fn(async (password: string) => `hashed_${password}`),
  compare: vi.fn(async () => true),
  default: {
    hash: vi.fn(async (password: string) => `hashed_${password}`),
    compare: vi.fn(async () => true),
  },
}));

describe('POST /api/v1/auth/signup', () => {
  beforeEach(async () => {
    // Clean up test users before each test
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'test-signup-' } },
    });
    vi.clearAllMocks();
  });

  afterAll(async () => {
    // Clean up test users
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'test-signup-' } },
    });
    await prisma.$disconnect();
  });

  describe('Success Cases', () => {
    it('should create new user with valid credentials', async () => {
      const request = new NextRequest('http://localhost:3000/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test-signup-valid@example.com',
          password: 'Password123',
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data).toHaveProperty('accessToken');
      expect(data).toHaveProperty('refreshToken');
      expect(data).toHaveProperty('user');
      expect(data.user).toHaveProperty('email', 'test-signup-valid@example.com');
      expect(data.user).toHaveProperty('role', 'free');
      expect(data.user).toHaveProperty('plan', 'free');
      expect(data.user).not.toHaveProperty('passwordHash');

      // Verify cookies are set
      const cookies = response.headers.get('set-cookie');
      expect(cookies).toBeTruthy();
      expect(cookies).toContain('nexus-session=');
      expect(cookies).toContain('nexus-refresh=');
      expect(cookies).toContain('HttpOnly');
      expect(cookies).toContain('SameSite=Strict');
    });

    it('should create user in database with correct fields', async () => {
      const email = 'test-signup-db@example.com';
      const request = new NextRequest('http://localhost:3000/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'Password123',
        }),
      });

      await POST(request);

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user).toBeTruthy();
      expect(user?.email).toBe(email);
      expect(user?.role).toBe('free');
      expect(user?.plan).toBe('free');
      expect(user?.passwordHash).toBeTruthy();
      expect(user?.passwordHash).toContain('hashed_');
    });
  });

  describe('Validation Errors', () => {
    it('should reject missing email', async () => {
      const request = new NextRequest('http://localhost:3000/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: 'Password123',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json).toHaveProperty('error', 'Invalid input');
      expect(json).toHaveProperty('details');
    });

    it('should reject missing password', async () => {
      const request = new NextRequest('http://localhost:3000/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test-signup-nopass@example.com',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json).toHaveProperty('error', 'Invalid input');
      expect(json).toHaveProperty('details');
    });

    it('should reject invalid email format', async () => {
      const request = new NextRequest('http://localhost:3000/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'not-an-email',
          password: 'Password123',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json).toHaveProperty('error', 'Invalid input');
      expect(json).toHaveProperty('details');
    });

    it('should reject weak password (too short)', async () => {
      const request = new NextRequest('http://localhost:3000/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test-signup-weak@example.com',
          password: 'Pass1',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json).toHaveProperty('error', 'Weak password');
      expect(json).toHaveProperty('details');
    });

    it('should reject weak password (no uppercase)', async () => {
      const request = new NextRequest('http://localhost:3000/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test-signup-noupper@example.com',
          password: 'password123',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json).toHaveProperty('error', 'Weak password');
      expect(json).toHaveProperty('details');
    });

    it('should reject weak password (no lowercase)', async () => {
      const request = new NextRequest('http://localhost:3000/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test-signup-nolower@example.com',
          password: 'PASSWORD123',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json).toHaveProperty('error', 'Weak password');
      expect(json).toHaveProperty('details');
    });

    it('should reject weak password (no number)', async () => {
      const request = new NextRequest('http://localhost:3000/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test-signup-nonum@example.com',
          password: 'PasswordABC',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json).toHaveProperty('error', 'Weak password');
      expect(json).toHaveProperty('details');
    });
  });
  describe('Business Logic Errors', () => {
    it('should reject duplicate email', async () => {
      const email = 'test-signup-duplicate@example.com';

      // Create first user
      await prisma.user.create({
        data: {
          email,
          passwordHash: 'hashed_password',
          role: 'free',
          plan: 'free',
        },
      });

      // Attempt to create duplicate
      const request = new NextRequest('http://localhost:3000/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'Password123',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json).toHaveProperty('error', 'Email already registered');
    });
  });

  describe('Security', () => {
    it('should set secure cookie attributes', async () => {
      const request = new NextRequest('http://localhost:3000/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test-signup-security@example.com',
          password: 'Password123',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(201);
      const json = await response.json();
      expect(json).toHaveProperty('accessToken');
      const cookies = response.headers.get('Set-Cookie');
      expect(cookies).toContain('HttpOnly');
      expect(cookies).toContain('SameSite=Strict');
    });

    it('should not return password hash in response', async () => {
      const request = new NextRequest('http://localhost:3000/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test-signup-nohash@example.com',
          password: 'Password123',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(201);
      const json = await response.json();
      expect(json).toHaveProperty('accessToken');
      expect(json.user).not.toHaveProperty('passwordHash');
      expect(JSON.stringify(json)).not.toContain('hashed_');
    });
  });

  describe('User Context', () => {
    it('should return user with correct role and plan', async () => {
      const request = new NextRequest('http://localhost:3000/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test-signup-context@example.com',
          password: 'Password123',
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.user.role).toBe('free');
      expect(data.user.plan).toBe('free');
    });
  });
});
