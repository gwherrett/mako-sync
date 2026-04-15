import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DiscogsAuthManager } from '../discogsAuthManager.service';
import { supabase } from '@/integrations/supabase/client';

// fetch is mocked per-test via vi.stubGlobal

describe('DiscogsAuthManager', () => {
  let manager: DiscogsAuthManager;

  beforeEach(() => {
    // Reset singleton so each test gets a clean instance
    (DiscogsAuthManager as any).instance = null;
    manager = DiscogsAuthManager.getInstance();
    vi.clearAllMocks();
  });

  afterEach(() => {
    (DiscogsAuthManager as any).instance = null;
  });

  // ---------------------------------------------------------------------------
  // Singleton
  // ---------------------------------------------------------------------------

  describe('Singleton pattern', () => {
    it('returns the same instance on repeated calls', () => {
      const a = DiscogsAuthManager.getInstance();
      const b = DiscogsAuthManager.getInstance();
      expect(a).toBe(b);
    });

    it('creates a fresh instance after manual reset', () => {
      const first = DiscogsAuthManager.getInstance();
      (DiscogsAuthManager as any).instance = null;
      const second = DiscogsAuthManager.getInstance();
      expect(first).not.toBe(second);
    });
  });

  // ---------------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------------

  describe('Initial state', () => {
    it('initialises with disconnected, idle state', () => {
      const state = manager.getState();
      expect(state).toEqual({
        isConnected: false,
        isLoading: false,
        connection: null,
        error: null,
        lastCheck: 0,
      });
    });

    it('getState returns a copy, not the internal reference', () => {
      const s1 = manager.getState();
      const s2 = manager.getState();
      expect(s1).not.toBe(s2);
    });
  });

  // ---------------------------------------------------------------------------
  // Subscribe / unsubscribe
  // ---------------------------------------------------------------------------

  describe('subscribe / unsubscribe', () => {
    it('notifies listener when state changes', () => {
      const listener = vi.fn();
      manager.subscribe(listener);

      // Trigger an internal state change via checkConnection error path
      manager['setState']({ error: 'test' });

      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ error: 'test' }));
    });

    it('stops notifying after unsubscribe', () => {
      const listener = vi.fn();
      const unsubscribe = manager.subscribe(listener);
      unsubscribe();

      manager['setState']({ error: 'after-unsub' });

      expect(listener).not.toHaveBeenCalled();
    });

    it('multiple listeners all receive updates', () => {
      const l1 = vi.fn();
      const l2 = vi.fn();
      manager.subscribe(l1);
      manager.subscribe(l2);

      manager['setState']({ isConnected: true });

      expect(l1).toHaveBeenCalledWith(expect.objectContaining({ isConnected: true }));
      expect(l2).toHaveBeenCalledWith(expect.objectContaining({ isConnected: true }));
    });
  });

  // ---------------------------------------------------------------------------
  // checkConnection
  // ---------------------------------------------------------------------------

  describe('checkConnection', () => {
    it('returns cached result when within cooldown window', async () => {
      manager['state'].lastCheck = Date.now();
      manager['state'].isConnected = true;

      const result = await manager.checkConnection();

      expect(result).toEqual({ success: true });
      // supabase.from should not have been called
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('bypasses cooldown when force=true', async () => {
      manager['state'].lastCheck = Date.now();
      manager['state'].isConnected = true;

      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockReturnValue({
            then: (fn: any) => Promise.resolve({ data: null, error: null }).then(fn),
          }),
        }),
      } as any);

      await manager.checkConnection(true);

      expect(supabase.from).toHaveBeenCalledWith('discogs_connections');
    });

    it('sets isConnected=true when a connection row is returned', async () => {
      const mockConnection = {
        id: 'conn-1',
        user_id: 'user-1',
        discogs_username: 'testuser',
        access_token_secret_id: 'vault-id-1',
        access_secret_secret_id: 'vault-id-2',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockReturnValue({
            then: (fn: any) => Promise.resolve({ data: mockConnection, error: null }).then(fn),
          }),
        }),
      } as any);

      const result = await manager.checkConnection(true);

      expect(result.success).toBe(true);
      expect(manager.getState().isConnected).toBe(true);
      expect(manager.getState().connection).toEqual(mockConnection);
      expect(manager.getState().isLoading).toBe(false);
    });

    it('sets isConnected=false when no row is returned', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockReturnValue({
            then: (fn: any) => Promise.resolve({ data: null, error: null }).then(fn),
          }),
        }),
      } as any);

      const result = await manager.checkConnection(true);

      expect(result.success).toBe(true);
      expect(manager.getState().isConnected).toBe(false);
      expect(manager.getState().connection).toBeNull();
    });

    it('handles database error and surfaces error message in state', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockReturnValue({
            then: (fn: any) =>
              Promise.resolve({ data: null, error: { message: 'DB unavailable' } }).then(fn),
          }),
        }),
      } as any);

      const result = await manager.checkConnection(true);

      expect(result.success).toBe(false);
      expect(result.error).toBe('DB unavailable');
      expect(manager.getState().error).toBe('DB unavailable');
      expect(manager.getState().isLoading).toBe(false);
    });

    it('deduplicates concurrent check calls — only one query runs', async () => {
      const maybeSingleMock = vi.fn().mockReturnValue({
        then: (fn: any) => Promise.resolve({ data: null, error: null }).then(fn),
      });

      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          maybeSingle: maybeSingleMock,
        }),
      } as any);

      // Fire two checks simultaneously
      await Promise.all([manager.checkConnection(true), manager.checkConnection(true)]);

      // Despite two calls, only one DB query should have been issued
      expect(maybeSingleMock).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // connect
  // ---------------------------------------------------------------------------

  describe('connect', () => {
    it('returns error when user is not authenticated', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: null },
        error: null,
      } as any);

      const result = await manager.connect('http://localhost/discogs-callback');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not authenticated');
      expect(manager.getState().isLoading).toBe(false);
    });

    it('stores request token in sessionStorage and returns authorizeUrl on success', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { access_token: 'jwt-abc' } },
        error: null,
      } as any);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          oauth_token: 'req-token',
          oauth_token_secret: 'req-secret',
          authorize_url: 'https://discogs.com/oauth/authorize?oauth_token=req-token',
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await manager.connect('http://localhost/discogs-callback');

      expect(result.success).toBe(true);
      expect(result.data?.authorizeUrl).toContain('discogs.com/oauth/authorize');
      expect(sessionStorage.setItem).toHaveBeenCalledWith('discogs_oauth_token_secret', 'req-secret');
      expect(sessionStorage.setItem).toHaveBeenCalledWith('discogs_oauth_token', 'req-token');
      expect(manager.getState().isLoading).toBe(false);
    });

    it('returns error and clears loading on fetch failure', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { access_token: 'jwt-abc' } },
        error: null,
      } as any);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Discogs unavailable' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await manager.connect('http://localhost/discogs-callback');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Discogs unavailable');
      expect(manager.getState().isLoading).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // disconnect
  // ---------------------------------------------------------------------------

  describe('disconnect', () => {
    it('returns error when user is not authenticated', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: null },
        error: null,
      } as any);

      const result = await manager.disconnect();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not authenticated');
    });

    it('clears connection state on success', async () => {
      // Prime state as connected
      manager['state'].isConnected = true;
      manager['state'].connection = { id: 'c1' } as any;

      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { access_token: 'jwt-abc' } },
        error: null,
      } as any);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await manager.disconnect();

      expect(result.success).toBe(true);
      expect(manager.getState().isConnected).toBe(false);
      expect(manager.getState().connection).toBeNull();
      expect(manager.getState().isLoading).toBe(false);
    });

    it('surfaces error message and clears loading on fetch failure', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { access_token: 'jwt-abc' } },
        error: null,
      } as any);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Delete failed' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await manager.disconnect();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Delete failed');
      expect(manager.getState().isLoading).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // exchangeAccessToken
  // ---------------------------------------------------------------------------

  describe('exchangeAccessToken', () => {
    it('returns error when user is not authenticated', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: null },
        error: null,
      } as any);

      const result = await manager.exchangeAccessToken('tok', 'ver', 'secret');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not authenticated');
    });

    it('clears sessionStorage and refreshes connection on success', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { access_token: 'jwt-abc' } },
        error: null,
      } as any);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });
      vi.stubGlobal('fetch', mockFetch);

      // Stub checkConnection to avoid another supabase call
      const checkSpy = vi.spyOn(manager, 'checkConnection').mockResolvedValue({ success: true });

      const result = await manager.exchangeAccessToken('oauth-tok', 'oauth-ver', 'tok-secret');

      expect(result.success).toBe(true);
      expect(sessionStorage.removeItem).toHaveBeenCalledWith('discogs_oauth_token_secret');
      expect(sessionStorage.removeItem).toHaveBeenCalledWith('discogs_oauth_token');
      expect(checkSpy).toHaveBeenCalledWith(true);
    });

    it('surfaces error message on fetch failure', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { access_token: 'jwt-abc' } },
        error: null,
      } as any);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Token exchange failed' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await manager.exchangeAccessToken('tok', 'ver', 'secret');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Token exchange failed');
      expect(manager.getState().isLoading).toBe(false);
    });
  });
});
