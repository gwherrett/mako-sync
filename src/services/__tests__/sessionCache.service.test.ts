import { describe, it, expect, vi, beforeEach } from 'vitest';
import SessionCacheService from '../sessionCache.service';
import { supabase } from '@/integrations/supabase/client';
import type { Session } from '@supabase/supabase-js';

// Mock supabase client
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}));

describe('SessionCacheService', () => {
  let cacheService: SessionCacheService;

  beforeEach(() => {
    vi.clearAllMocks();
    cacheService = SessionCacheService.getInstance();
    cacheService.clearCache();
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = SessionCacheService.getInstance();
      const instance2 = SessionCacheService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('getCacheStatus', () => {
    it('should return cache status object', () => {
      const status = cacheService.getCacheStatus();
      
      expect(status).toHaveProperty('hasCached');
      expect(status).toHaveProperty('cacheAge');
      expect(status).toHaveProperty('isValid');
      expect(status).toHaveProperty('hasPending');
      expect(status).toHaveProperty('activeContexts');
      expect(status).toHaveProperty('validationInProgress');
      expect(status).toHaveProperty('concurrentValidations');
    });

    it('should report no cache initially', () => {
      const status = cacheService.getCacheStatus();
      expect(status.hasCached).toBe(false);
      expect(status.isValid).toBe(false);
    });
  });

  describe('clearCache', () => {
    it('should clear the cache', () => {
      cacheService.clearCache();
      const status = cacheService.getCacheStatus();
      expect(status.hasCached).toBe(false);
    });
  });

  describe('isAuthStable', () => {
    it('should return true when no validations in progress', () => {
      const isStable = cacheService.isAuthStable();
      expect(isStable).toBe(true);
    });
  });

  describe('getSession', () => {
    it('should return session result', async () => {
      const result = await cacheService.getSession();

      expect(result).toHaveProperty('session');
      expect(result).toHaveProperty('error');
    });

    it('should return cached session when valid', async () => {
      // First call to populate cache
      await cacheService.getSession();

      // Second call should return cached
      const result = await cacheService.getSession();

      expect(result).toHaveProperty('session');
      expect(result).toHaveProperty('error');
    });

    it('should handle force refresh', async () => {
      const result = await cacheService.getSession(true);

      expect(result).toHaveProperty('session');
      expect(result).toHaveProperty('error');
    });

    it('should handle context parameter', async () => {
      const result = await cacheService.getSession(false, 'test-context');

      expect(result).toHaveProperty('session');
      expect(result).toHaveProperty('error');
    });

    it('should handle initialization priority', async () => {
      const result = await cacheService.getSession(false, 'init', 'initialization');

      expect(result).toHaveProperty('session');
      expect(result).toHaveProperty('error');
    });

    it('should handle background priority', async () => {
      const result = await cacheService.getSession(false, undefined, 'background');

      expect(result).toHaveProperty('session');
      expect(result).toHaveProperty('error');
    });
  });

  describe('setSessionFromAuthContext', () => {
    it('should pre-populate cache with valid session', () => {
      const mockSession = {
        user: { id: 'user-123', email: 'test@example.com' },
        access_token: 'token-123',
        expires_at: Date.now() + 3600
      };

      cacheService.setSessionFromAuthContext(mockSession as any);

      const status = cacheService.getCacheStatus();
      expect(status.hasCached).toBe(true);
      expect(status.isValid).toBe(true);
    });

    it('should not set cache with null session', () => {
      cacheService.setSessionFromAuthContext(null);

      const status = cacheService.getCacheStatus();
      expect(status.hasCached).toBe(false);
    });

    it('should use pre-populated session for subsequent getSession calls', async () => {
      const mockSession = {
        user: { id: 'user-123', email: 'test@example.com' },
        access_token: 'token-123',
        expires_at: Date.now() + 3600
      };

      cacheService.setSessionFromAuthContext(mockSession as any);

      const result = await cacheService.getSession();

      expect(result.session).toEqual(mockSession);
      expect(result.error).toBeNull();
    });
  });

  describe('forceRefresh', () => {
    it('should clear cache and return new session', async () => {
      const result = await cacheService.forceRefresh();

      expect(result).toHaveProperty('session');
      expect(result).toHaveProperty('error');
    });
  });

  describe('getCacheStatus extended', () => {
    it('should return validation status fields', () => {
      const status = cacheService.getCacheStatus();

      expect(typeof status.validationInProgress).toBe('boolean');
      expect(typeof status.concurrentValidations).toBe('number');
    });

    it('should return correct cache age when cache exists', () => {
      const mockSession = {
        user: { id: 'user-123', email: 'test@example.com' },
        access_token: 'token-123',
        expires_at: Date.now() + 3600
      };

      cacheService.setSessionFromAuthContext(mockSession as any);

      const status = cacheService.getCacheStatus();

      expect(status.cacheAge).not.toBeNull();
      expect(typeof status.cacheAge).toBe('number');
    });
  });

  describe('server validation of a fetched session', () => {
    const session = {
      user: { id: 'user-1' },
      access_token: 'token-1',
      expires_at: 123,
    } as unknown as Session;
    const getSession = vi.mocked(supabase.auth.getSession);
    const getUser = vi.mocked(supabase.auth.getUser);
    const signOut = vi.mocked(supabase.auth.signOut);

    const returnSession = () =>
      getSession.mockResolvedValue({ data: { session }, error: null } as never);
    const returnUser = (user: unknown, error: unknown) =>
      getUser.mockResolvedValue({ data: { user }, error } as never);

    beforeEach(() => {
      // Earlier tests leave a pre-populated session on the singleton, and clearCache()
      // doesn't reset it. Drop it so every call here reaches fetchSessionDirect.
      (cacheService as unknown as { prePopulatedSession: Session | null }).prePopulatedSession = null;
      signOut.mockResolvedValue({ error: null } as never);
    });

    it('returns and caches the session when the server confirms the user', async () => {
      returnSession();
      returnUser({ id: 'user-1' }, null);

      const result = await cacheService.getSession(true);

      expect(result).toEqual({ session, error: null });
      expect(cacheService.getCacheStatus().isValid).toBe(true);
      expect(cacheService.isAuthStable()).toBe(true);
    });

    it('returns the Supabase error when getSession fails, without caching it', async () => {
      const error = { message: 'storage broken' };
      getSession.mockResolvedValue({ data: { session: null }, error } as never);

      const result = await cacheService.getSession(true);

      expect(result).toEqual({ session: null, error });
      expect(getUser).not.toHaveBeenCalled();
      expect(cacheService.getCacheStatus().hasCached).toBe(false);
    });

    it('signs out locally and returns the error for a stale token', async () => {
      const userError = { message: 'invalid JWT' };
      returnSession();
      returnUser(null, userError);

      const result = await cacheService.getSession(true);

      expect(result).toEqual({ session: null, error: userError });
      expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    });

    it('reports a stale token when the server returns no user and no error', async () => {
      returnSession();
      returnUser(null, null);

      const result = await cacheService.getSession(true);

      expect(result.session).toBeNull();
      expect((result.error as Error).message).toBe('Stale token detected');
      expect(signOut).toHaveBeenCalled();
    });

    it.each(['request timeout', 'network down', 'failed to fetch'])(
      'keeps the session when getUser returns a "%s" error',
      async message => {
        returnSession();
        returnUser(null, { message });

        const result = await cacheService.getSession(true);

        expect(result).toEqual({ session, error: null });
        expect(signOut).not.toHaveBeenCalled();
      }
    );

    it('keeps the session when getUser throws a timeout', async () => {
      returnSession();
      getUser.mockRejectedValue(new Error('Session validation timeout'));

      const result = await cacheService.getSession(true);

      expect(result).toEqual({ session, error: null });
      expect(signOut).not.toHaveBeenCalled();
    });

    it('keeps the session when getUser throws an AbortError', async () => {
      returnSession();
      const abort = new Error('aborted');
      abort.name = 'AbortError';
      getUser.mockRejectedValue(abort);

      const result = await cacheService.getSession(true);

      expect(result).toEqual({ session, error: null });
    });

    it('signs out and returns the error when getUser throws anything else', async () => {
      returnSession();
      const boom = new Error('unexpected');
      getUser.mockRejectedValue(boom);

      const result = await cacheService.getSession(true);

      expect(result).toEqual({ session: null, error: boom });
      expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
      expect(cacheService.isAuthStable()).toBe(true);
    });

    it('returns the thrown error when getSession itself throws', async () => {
      const boom = new Error('client crashed');
      getSession.mockRejectedValue(boom);

      const result = await cacheService.getSession(true);

      expect(result).toEqual({ session: null, error: boom });
    });

    it('skips validation once two validations are already running', async () => {
      returnSession();
      const releases: Array<() => void> = [];
      getUser.mockImplementation(
        () =>
          new Promise(resolve => {
            releases.push(() => resolve({ data: { user: { id: 'user-1' } }, error: null } as never));
          }) as never
      );

      const first = cacheService.getSession(true, 'a');
      const second = cacheService.getSession(true, 'b');
      await vi.waitFor(() => expect(getUser).toHaveBeenCalledTimes(2));
      expect(cacheService.isAuthStable()).toBe(false);

      const third = await cacheService.getSession(true, 'c');

      expect(third).toEqual({ session, error: null });
      expect(getUser).toHaveBeenCalledTimes(2);

      releases.forEach(release => release());
      await Promise.all([first, second]);
      expect(cacheService.isAuthStable()).toBe(true);
    });

    it('shares one in-flight initialization request', async () => {
      returnSession();
      returnUser({ id: 'user-1' }, null);

      const [a, b] = await Promise.all([
        cacheService.getSession(true, undefined, 'initialization'),
        cacheService.getSession(false, undefined, 'initialization'),
      ]);

      expect(a).toBe(b);
      expect(getSession).toHaveBeenCalledTimes(1);
    });

    it('shares one in-flight request per context', async () => {
      returnSession();
      returnUser({ id: 'user-1' }, null);

      const [a, b] = await Promise.all([
        cacheService.getSession(true, 'ctx'),
        cacheService.getSession(false, 'ctx'),
      ]);

      expect(a).toBe(b);
      expect(getSession).toHaveBeenCalledTimes(1);
      expect(cacheService.getCacheStatus().activeContexts).toBe(0);
    });

    it('shares the pending request with a background caller', async () => {
      returnSession();
      returnUser({ id: 'user-1' }, null);

      const first = cacheService.getSession(true);
      const second = cacheService.getSession(false, undefined, 'background');
      expect(cacheService.getCacheStatus().hasPending).toBe(true);

      const [a, b] = await Promise.all([first, second]);

      expect(a).toBe(b);
      expect(getSession).toHaveBeenCalledTimes(1);
    });
  });

  describe('clearCache browser storage', () => {
    it('removes auth-related localStorage keys and clears sessionStorage', () => {
      const storage = localStorage as unknown as Record<string, unknown>;
      storage['sb-project-auth-token'] = 'x';

      cacheService.clearCache();

      expect(localStorage.removeItem).toHaveBeenCalledWith('sb-project-auth-token');
      expect(sessionStorage.clear).toHaveBeenCalled();
      delete storage['sb-project-auth-token'];
    });
  });
});
