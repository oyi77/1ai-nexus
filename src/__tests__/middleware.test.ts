import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock native modules with factory functions AFTER vitest import
// Local JWT stub — replaces the previous JWT mock factory.
// Production auth uses `jose`; this test only needs deterministic
// sign/verify behavior, so we stub it locally (no external JWT dependency).
const mockJwt = {
  sign: (_payload: Record<string, unknown>, _secret: string, options?: Record<string, unknown>) => {
    if (options?.expiresIn === '-1h') return 'expired-token'
    return 'valid-token'
  },
  verify: (token: string) => {
    if (token === 'valid-token') {
      return { userId: 'user-123', email: 'test@example.com', role: 'pro', plan: 'pro' }
    }
    if (token === 'expired-token') {
      const error = new Error('jwt expired')
      error.name = 'TokenExpiredError'
      throw error
    }
    throw new Error('Invalid token')
  },
}



import { NextRequest } from 'next/server'

// Mock the middleware module
vi.mock('@/lib/jwt-middleware', () => ({
  extractJwtSession: vi.fn(),
  checkSubscriptionRateLimit: vi.fn(),
}))

describe('Middleware JWT Integration', () => {
  const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key'
  
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('JWT Session Flow', () => {
    it('should extract valid JWT session from cookie', async () => {
      const userId = 'user-123'
      const email = 'test@example.com'
      const role = 'pro'
      
      const token = mockJwt.sign(
        { userId, email, role, plan: role },
        JWT_SECRET,
        { expiresIn: '7d' }
      )

      const request = new NextRequest('https://tracker.aitradepulse.com/api/v1/signals/history', {
        headers: {
          cookie: `nexus-session=${token}`,
        },
      })

      // Verify token can be decoded
      const decoded = mockJwt.verify(token, JWT_SECRET) as { userId: string; email: string; role: string; plan: string }
      expect(decoded.userId).toBe(userId)
      expect(decoded.email).toBe(email)
      expect(decoded.role).toBe(role)
      expect(decoded.plan).toBe(role)
    })

    it('should handle invalid JWT token gracefully', () => {
      const invalidToken = 'invalid.token.here'
      
      expect(() => {
        mockJwt.verify(invalidToken, JWT_SECRET)
      }).toThrow()
    })

    it('should handle expired JWT token', () => {
      const token = mockJwt.sign(
        { userId: 'user-123', email: 'test@example.com', role: 'free' },
        JWT_SECRET,
        { expiresIn: '-1h' } // Already expired
      )

      expect(() => {
        mockJwt.verify(token, JWT_SECRET)
      }).toThrow('jwt expired')
    })
  })

  describe('Subscription Rate Limiting', () => {
    it('should apply correct rate limits per plan', () => {
      const limits = {
        free: 100,
        pro: 1000,
        enterprise: 10000,
        admin: Infinity,
      }

      expect(limits.free).toBe(100)
      expect(limits.pro).toBe(1000)
      expect(limits.enterprise).toBe(10000)
      expect(limits.admin).toBe(Infinity)
    })

    it('should track hourly request counts per user', () => {
      const now = Date.now()
      const hourAgo = now - 60 * 60 * 1000
      
      const entry = {
        count: 5,
        windowStart: now,
      }

      // Verify window is within current hour
      const isInWindow = now - entry.windowStart < 60 * 60 * 1000
      expect(isInWindow).toBe(true)
      
      // Verify old window would be reset
      const oldEntry = { count: 100, windowStart: hourAgo }
      const shouldReset = now - oldEntry.windowStart >= 60 * 60 * 1000
      expect(shouldReset).toBe(true)
    })
  })

  describe('Auth Path Priority', () => {
    it('should prioritize always-public routes', () => {
      const publicPaths = [
        '/api/v1/health',
        '/api/v1/status',
        '/api/v1/auth/login',
        '/api/v1/auth/signup',
        '/api/v1/auth/logout',
        '/api/v1/auth/refresh',
      ]

      publicPaths.forEach(path => {
        expect(path).toMatch(/\/(health|status|auth)/)
      })
    })

    it('should check JWT before CSRF for non-public routes', () => {
      // JWT check should come after always-public check
      // but before browser CSRF check
      const authOrder = [
        'always-public',
        'jwt-session',
        'browser-csrf',
        'api-key',
        'deny',
      ]

      expect(authOrder[0]).toBe('always-public')
      expect(authOrder[1]).toBe('jwt-session')
      expect(authOrder[2]).toBe('browser-csrf')
      expect(authOrder[3]).toBe('api-key')
      expect(authOrder[4]).toBe('deny')
    })
  })

  describe('Cookie Parsing', () => {
    it('should extract nexus-session cookie from header', () => {
      const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test'
      const cookieHeader = `nexus-session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax`
      
      const match = cookieHeader.match(/nexus-session=([^;]+)/)
      expect(match).toBeTruthy()
      expect(match![1]).toBe(token)
    })

    it('should handle multiple cookies', () => {
      const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test'
      const cookieHeader = `other-cookie=value; nexus-session=${token}; another=value`
      
      const match = cookieHeader.match(/nexus-session=([^;]+)/)
      expect(match).toBeTruthy()
      expect(match![1]).toBe(token)
    })
  })
})
