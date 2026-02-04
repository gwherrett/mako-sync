import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TokenPersistenceGatewayService, { tokenPersistenceGateway } from '../tokenPersistenceGateway.service';

// Mock supabase
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      setSession: vi.fn().mockResolvedValue({ data: {}, error: null })
    }
  }
}));

describe('TokenPersistenceGatewayService', () => {
  let service: TokenPersistenceGatewayService;
  let localStorageMock: { [key: string]: string };
  const originalObjectKeys = Object.keys;

  beforeEach(() => {
    // Reset singleton for testing
    (TokenPersistenceGatewayService as any).instance = null;
    service = TokenPersistenceGatewayService.getInstance();

    // Mock localStorage data
    localStorageMock = {};

    // Create a custom localStorage mock that properly handles Object.keys
    const localStorageProxy = {
      getItem: vi.fn((key: string) => localStorageMock[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        localStorageMock[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete localStorageMock[key];
      }),
      clear: vi.fn(() => {
        localStorageMock = {};
      }),
      key: vi.fn((index: number) => originalObjectKeys(localStorageMock)[index] || null),
      get length() {
        return originalObjectKeys(localStorageMock).length;
      }
    };

    vi.stubGlobal('localStorage', localStorageProxy);

    // Override Object.keys to handle localStorage correctly
    Object.keys = function(obj: object) {
      if (obj === localStorageProxy) {
        return originalObjectKeys(localStorageMock);
      }
      return originalObjectKeys(obj);
    };
  });

  afterEach(() => {
    Object.keys = originalObjectKeys;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    service.reset();
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = TokenPersistenceGatewayService.getInstance();
      const instance2 = TokenPersistenceGatewayService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('isTokenPersisted', () => {
    it('should return false when no auth key exists', () => {
      const result = service.isTokenPersisted('test-token');
      expect(result).toBe(false);
    });

    it('should return false when stored token does not match', () => {
      localStorageMock['sb-test-auth-token'] = JSON.stringify({
        access_token: 'different-token'
      });

      const result = service.isTokenPersisted('test-token');
      expect(result).toBe(false);
    });

    it('should return true when stored token matches', () => {
      localStorageMock['sb-test-auth-token'] = JSON.stringify({
        access_token: 'matching-token'
      });

      const result = service.isTokenPersisted('matching-token');
      expect(result).toBe(true);
    });

    it('should return false on JSON parse error', () => {
      localStorageMock['sb-test-auth-token'] = 'invalid-json';

      const result = service.isTokenPersisted('test-token');
      expect(result).toBe(false);
    });

    it('should return false when localStorage.getItem returns null', () => {
      // Key exists in Object.keys but getItem returns null
      localStorageMock['sb-test-auth-token'] = '';
      vi.mocked(localStorage.getItem).mockReturnValue(null);

      const result = service.isTokenPersisted('test-token');
      expect(result).toBe(false);
    });
  });

  describe('markTokenReady', () => {
    it('should set tokenReady to true', () => {
      expect(service.isReady()).toBe(false);
      service.markTokenReady();
      expect(service.isReady()).toBe(true);
    });

    it('should call all pending callbacks', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      service.onTokenReady(callback1);
      service.onTokenReady(callback2);

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).not.toHaveBeenCalled();

      service.markTokenReady();

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
    });

    it('should handle callback errors gracefully', () => {
      const errorCallback = vi.fn(() => {
        throw new Error('Callback error');
      });
      const successCallback = vi.fn();

      service.onTokenReady(errorCallback);
      service.onTokenReady(successCallback);

      // Should not throw
      expect(() => service.markTokenReady()).not.toThrow();

      // Both callbacks should still have been attempted
      expect(errorCallback).toHaveBeenCalled();
      expect(successCallback).toHaveBeenCalled();
    });
  });

  describe('onTokenReady', () => {
    it('should call callback immediately if token is already ready', () => {
      service.markTokenReady();

      const callback = vi.fn();
      service.onTokenReady(callback);

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should queue callback if token is not ready', () => {
      const callback = vi.fn();
      service.onTokenReady(callback);

      expect(callback).not.toHaveBeenCalled();
    });

    it('should return cleanup function that removes callback', () => {
      const callback = vi.fn();
      const cleanup = service.onTokenReady(callback);

      cleanup();
      service.markTokenReady();

      expect(callback).not.toHaveBeenCalled();
    });

    it('should return no-op cleanup when called with ready state', () => {
      service.markTokenReady();

      const callback = vi.fn();
      const cleanup = service.onTokenReady(callback);

      // Callback should have been called once
      expect(callback).toHaveBeenCalledTimes(1);

      // Cleanup should be a no-op (no error)
      expect(() => cleanup()).not.toThrow();
    });
  });

  describe('isReady', () => {
    it('should return false initially', () => {
      expect(service.isReady()).toBe(false);
    });

    it('should return true after markTokenReady', () => {
      service.markTokenReady();
      expect(service.isReady()).toBe(true);
    });
  });

  describe('reset', () => {
    it('should reset tokenReady to false', () => {
      service.markTokenReady();
      expect(service.isReady()).toBe(true);

      service.reset();
      expect(service.isReady()).toBe(false);
    });

    it('should clear pending callbacks', () => {
      const callback = vi.fn();
      service.onTokenReady(callback);

      service.reset();
      service.markTokenReady();

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('waitForTokenPersistence', () => {
    const mockSession = {
      access_token: 'test-access-token-12345',
      refresh_token: 'test-refresh-token',
      user: { id: 'user-123' }
    } as any;

    it('should return true immediately when token is already persisted', async () => {
      localStorageMock['sb-test-auth-token'] = JSON.stringify({
        access_token: 'test-access-token-12345'
      });

      const result = await service.waitForTokenPersistence(mockSession, 100);

      expect(result).toBe(true);
      expect(service.isReady()).toBe(true);
    });

    it('should return true after polling finds token', async () => {
      // Token appears after 50ms
      setTimeout(() => {
        localStorageMock['sb-test-auth-token'] = JSON.stringify({
          access_token: 'test-access-token-12345'
        });
      }, 50);

      const result = await service.waitForTokenPersistence(mockSession, 200);

      expect(result).toBe(true);
      expect(service.isReady()).toBe(true);
    });

    it('should return false after timeout when token never appears', async () => {
      const result = await service.waitForTokenPersistence(mockSession, 50);

      // Should timeout but still mark as ready to avoid blocking
      expect(result).toBe(false);
      expect(service.isReady()).toBe(true);
    });

    it('should handle setSession timeout gracefully', async () => {
      // Token is persisted
      localStorageMock['sb-test-auth-token'] = JSON.stringify({
        access_token: 'test-access-token-12345'
      });

      // But setSession hangs
      const { supabase } = await import('@/integrations/supabase/client');
      vi.mocked(supabase.auth.setSession).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      const result = await service.waitForTokenPersistence(mockSession, 100);

      // Should still succeed despite setSession timeout
      expect(result).toBe(true);
      expect(service.isReady()).toBe(true);
    });

    it('should handle setSession error gracefully', async () => {
      localStorageMock['sb-test-auth-token'] = JSON.stringify({
        access_token: 'test-access-token-12345'
      });

      const { supabase } = await import('@/integrations/supabase/client');
      vi.mocked(supabase.auth.setSession).mockRejectedValue(new Error('Auth error'));

      const result = await service.waitForTokenPersistence(mockSession, 100);

      // Should still succeed despite error
      expect(result).toBe(true);
      expect(service.isReady()).toBe(true);
    });
  });

  describe('exported singleton', () => {
    it('should export a working singleton instance', () => {
      expect(tokenPersistenceGateway).toBeDefined();
      expect(tokenPersistenceGateway.isReady).toBeDefined();
      expect(tokenPersistenceGateway.markTokenReady).toBeDefined();
      expect(tokenPersistenceGateway.reset).toBeDefined();
    });
  });
});
