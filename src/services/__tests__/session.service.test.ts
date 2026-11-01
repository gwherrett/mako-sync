import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionService } from '../session.service';
import { supabase } from '@/integrations/supabase/client';

// Mock console to reduce noise
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('SessionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getSessionState', () => {
    it('should return session state when session exists and is valid', async () => {
      const futureTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      const mockSession = {
        expires_at: futureTime,
        access_token: 'test-token',
        user: { id: 'user-123' }
      };

      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: mockSession },
        error: null
      } as any);

      const result = await SessionService.getSessionState();

      expect(result.sessionState.session).toEqual(mockSession);
      expect(result.sessionState.isExpired).toBe(false);
      expect(result.sessionState.expiresAt).toBeInstanceOf(Date);
      expect(result.error).toBeNull();
    });

    it('should mark session as expired when expires_at is in the past', async () => {
      const pastTime = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      const mockSession = {
        expires_at: pastTime,
        access_token: 'test-token',
        user: { id: 'user-123' }
      };

      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: mockSession },
        error: null
      } as any);

      const result = await SessionService.getSessionState();

      expect(result.sessionState.isExpired).toBe(true);
    });

    it('should return null session when no session exists', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: null },
        error: null
      } as any);

      const result = await SessionService.getSessionState();

      expect(result.sessionState.session).toBeNull();
      expect(result.sessionState.isExpired).toBe(false);
      expect(result.sessionState.expiresAt).toBeNull();
    });

    it('should handle auth error', async () => {
      const mockError = { message: 'Auth error' };
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: null },
        error: mockError
      } as any);

      const result = await SessionService.getSessionState();

      expect(result.sessionState.session).toBeNull();
      expect(result.sessionState.isExpired).toBe(true);
      expect(result.error).toEqual(mockError);
    });

    it('should handle thrown exceptions', async () => {
      vi.mocked(supabase.auth.getSession).mockRejectedValue(new Error('Network error'));

      const result = await SessionService.getSessionState();

      expect(result.sessionState.session).toBeNull();
      expect(result.sessionState.isExpired).toBe(true);
      expect(result.error).toBeInstanceOf(Error);
    });
  });

  describe('refreshSession', () => {
    it('should refresh session successfully', async () => {
      const mockSession = {
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        access_token: 'new-token'
      };

      vi.mocked(supabase.auth.refreshSession).mockResolvedValue({
        data: { session: mockSession, user: null },
        error: null
      } as any);

      const result = await SessionService.refreshSession();

      expect(result.session).toEqual(mockSession);
      expect(result.error).toBeNull();
    });

    it('should handle refresh error', async () => {
      const mockError = { message: 'Refresh failed' };
      vi.mocked(supabase.auth.refreshSession).mockResolvedValue({
        data: { session: null, user: null },
        error: mockError
      } as any);

      const result = await SessionService.refreshSession();

      expect(result.session).toBeNull();
      expect(result.error).toEqual(mockError);
    });

    it('should handle thrown exceptions', async () => {
      vi.mocked(supabase.auth.refreshSession).mockRejectedValue(new Error('Network error'));

      const result = await SessionService.refreshSession();

      expect(result.session).toBeNull();
      expect(result.error).toBeInstanceOf(Error);
    });
  });

  describe('needsRefresh', () => {
    it('should return false when session is null', () => {
      expect(SessionService.needsRefresh(null)).toBe(false);
    });

    it('should return false when session has no expires_at', () => {
      const session = { access_token: 'test' } as any;
      expect(SessionService.needsRefresh(session)).toBe(false);
    });

    it('should return true when session expires within 5 minutes', () => {
      const threeMinutesFromNow = Math.floor(Date.now() / 1000) + (3 * 60);
      const session = { expires_at: threeMinutesFromNow } as any;

      expect(SessionService.needsRefresh(session)).toBe(true);
    });

    it('should return false when session expires more than 5 minutes from now', () => {
      const tenMinutesFromNow = Math.floor(Date.now() / 1000) + (10 * 60);
      const session = { expires_at: tenMinutesFromNow } as any;

      expect(SessionService.needsRefresh(session)).toBe(false);
    });
  });

  describe('autoRefreshIfNeeded', () => {
    it('should not refresh when session is null', async () => {
      const result = await SessionService.autoRefreshIfNeeded(null);

      expect(result.session).toBeNull();
      expect(result.wasRefreshed).toBe(false);
      expect(result.error).toBeNull();
    });

    it('should not refresh when session does not need refresh', async () => {
      const tenMinutesFromNow = Math.floor(Date.now() / 1000) + (10 * 60);
      const session = { expires_at: tenMinutesFromNow, access_token: 'test' } as any;

      const result = await SessionService.autoRefreshIfNeeded(session);

      expect(result.session).toEqual(session);
      expect(result.wasRefreshed).toBe(false);
      expect(supabase.auth.refreshSession).not.toHaveBeenCalled();
    });

    it('should refresh when session needs refresh', async () => {
      const twoMinutesFromNow = Math.floor(Date.now() / 1000) + (2 * 60);
      const oldSession = { expires_at: twoMinutesFromNow, access_token: 'old' } as any;
      const newSession = { expires_at: twoMinutesFromNow + 3600, access_token: 'new' };

      vi.mocked(supabase.auth.refreshSession).mockResolvedValue({
        data: { session: newSession, user: null },
        error: null
      } as any);

      const result = await SessionService.autoRefreshIfNeeded(oldSession);

      expect(result.session).toEqual(newSession);
      expect(result.wasRefreshed).toBe(true);
    });

    it('should return original session on refresh error', async () => {
      const twoMinutesFromNow = Math.floor(Date.now() / 1000) + (2 * 60);
      const oldSession = { expires_at: twoMinutesFromNow, access_token: 'old' } as any;

      vi.mocked(supabase.auth.refreshSession).mockResolvedValue({
        data: { session: null, user: null },
        error: { message: 'Refresh failed' }
      } as any);

      const result = await SessionService.autoRefreshIfNeeded(oldSession);

      expect(result.session).toEqual(oldSession);
      expect(result.wasRefreshed).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('getTimeUntilExpiry', () => {
    it('should return null when session is null', () => {
      expect(SessionService.getTimeUntilExpiry(null)).toBeNull();
    });

    it('should return null when session has no expires_at', () => {
      const session = { access_token: 'test' } as any;
      expect(SessionService.getTimeUntilExpiry(session)).toBeNull();
    });

    it('should return time in milliseconds until expiry', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const oneHourFromNow = Math.floor(now / 1000) + 3600;
      const session = { expires_at: oneHourFromNow } as any;

      const result = SessionService.getTimeUntilExpiry(session);

      // Should be approximately 1 hour in milliseconds
      expect(result).toBeGreaterThan(3500000);
      expect(result).toBeLessThanOrEqual(3600000);
    });
  });

  describe('setupAutoRefresh', () => {
    it('should return null when session is null', () => {
      const onRefresh = vi.fn();
      const onError = vi.fn();

      const cleanup = SessionService.setupAutoRefresh(null, onRefresh, onError);

      expect(cleanup).toBeNull();
    });

    it('should return null when session is already expired', () => {
      const onRefresh = vi.fn();
      const onError = vi.fn();
      const pastTime = Math.floor(Date.now() / 1000) - 3600;
      const session = { expires_at: pastTime } as any;

      const cleanup = SessionService.setupAutoRefresh(session, onRefresh, onError);

      expect(cleanup).toBeNull();
    });

    it('should setup timeout for refresh', () => {
      const onRefresh = vi.fn();
      const onError = vi.fn();
      const fiveMinutesFromNow = Math.floor(Date.now() / 1000) + (5 * 60);
      const session = { expires_at: fiveMinutesFromNow } as any;

      const cleanup = SessionService.setupAutoRefresh(session, onRefresh, onError);

      expect(cleanup).toBeInstanceOf(Function);
      expect(typeof cleanup).toBe('function');
    });

    it('should return cleanup function', () => {
      const onRefresh = vi.fn();
      const onError = vi.fn();
      const tenMinutesFromNow = Math.floor(Date.now() / 1000) + (10 * 60);
      const session = { expires_at: tenMinutesFromNow } as any;

      const cleanup = SessionService.setupAutoRefresh(session, onRefresh, onError);

      expect(cleanup).not.toBeNull();
      // Cleanup should not throw
      cleanup!();
    });
  });

  describe('validateSession', () => {
    it('should return invalid when session is null', async () => {
      const result = await SessionService.validateSession(null);

      expect(result.isValid).toBe(false);
      expect(result.error).toBeNull();
    });

    it('should return valid when user exists', async () => {
      const session = { access_token: 'test' } as any;

      vi.mocked(supabase.auth.getUser).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      } as any);

      const result = await SessionService.validateSession(session);

      expect(result.isValid).toBe(true);
      expect(result.error).toBeNull();
    });

    it('should return invalid on auth error', async () => {
      const session = { access_token: 'test' } as any;
      const mockError = { message: 'Invalid token' };

      vi.mocked(supabase.auth.getUser).mockResolvedValue({
        data: { user: null },
        error: mockError
      } as any);

      const result = await SessionService.validateSession(session);

      expect(result.isValid).toBe(false);
      expect(result.error).toEqual(mockError);
    });

    it('should handle thrown exceptions', async () => {
      const session = { access_token: 'test' } as any;

      vi.mocked(supabase.auth.getUser).mockRejectedValue(new Error('Network error'));

      const result = await SessionService.validateSession(session);

      expect(result.isValid).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
    });
  });
});
