import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/v1/auth/logout/route';
import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';

// Mock Next.js cookies
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

describe('POST /api/v1/auth/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Success Cases', () => {
    it('should clear session cookie and return success', async () => {
      const mockDelete = vi.fn();
      vi.mocked(cookies).mockResolvedValue({
        delete: mockDelete,
      } as unknown as Awaited<ReturnType<typeof cookies>>);

      const request = new NextRequest('http://localhost:3000/api/v1/auth/logout', {
        method: 'POST',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        success: true,
        message: 'Logged out successfully',
      });
      expect(mockDelete).toHaveBeenCalledWith('nexus-session');
    });

    it('should handle logout when no session exists', async () => {
      const mockDelete = vi.fn();
      vi.mocked(cookies).mockResolvedValue({
        delete: mockDelete,
      } as unknown as Awaited<ReturnType<typeof cookies>>);

      const request = new NextRequest('http://localhost:3000/api/v1/auth/logout', {
        method: 'POST',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockDelete).toHaveBeenCalledWith('nexus-session');
    });
  });

  describe('Error Cases', () => {
    it('should return 500 if cookie deletion fails', async () => {
      vi.mocked(cookies).mockRejectedValue(new Error('Cookie store error'));

      const request = new NextRequest('http://localhost:3000/api/v1/auth/logout', {
        method: 'POST',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({
        success: false,
        error: 'Failed to logout',
      });
    });

    it('should return 500 if cookies() throws unexpected error', async () => {
      vi.mocked(cookies).mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      const request = new NextRequest('http://localhost:3000/api/v1/auth/logout', {
        method: 'POST',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({
        success: false,
        error: 'Failed to logout',
      });
    });
  });

  describe('Response Format', () => {
    it('should return JSON with correct content-type', async () => {
      const mockDelete = vi.fn();
      vi.mocked(cookies).mockResolvedValue({
        delete: mockDelete,
      } as unknown as Awaited<ReturnType<typeof cookies>>);

      const request = new NextRequest('http://localhost:3000/api/v1/auth/logout', {
        method: 'POST',
      });

      const response = await POST(request);

      expect(response.headers.get('content-type')).toContain('application/json');
    });
  });
});
