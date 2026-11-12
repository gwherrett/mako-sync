import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  waitForAuthStability,
  waitForValidation,
  safeQuery,
  createQueryWrapper,
} from '../queryWrapper.service';
import { sessionCache } from '../sessionCache.service';
import { startupSessionValidator } from '../startupSessionValidator.service';

// Mock dependencies
vi.mock('../sessionCache.service', () => ({
  sessionCache: {
    isAuthStable: vi.fn()
  }
}));

vi.mock('../startupSessionValidator.service', () => ({
  startupSessionValidator: {
    isValidationComplete: vi.fn()
  }
}));

describe('queryWrapper.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('waitForAuthStability', () => {
    it('should return true immediately if already stable', async () => {
      vi.mocked(sessionCache.isAuthStable).mockReturnValue(true);

      const result = await waitForAuthStability('test-context');

      expect(result).toBe(true);
      expect(sessionCache.isAuthStable).toHaveBeenCalled();
    });

    it('should poll until auth becomes stable', async () => {
      vi.mocked(sessionCache.isAuthStable)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);

      const resultPromise = waitForAuthStability('test-context', 5000);

      await vi.advanceTimersByTimeAsync(100);
      const result = await resultPromise;

      expect(result).toBe(true);
    });

    it('should return false on timeout', async () => {
      vi.mocked(sessionCache.isAuthStable).mockReturnValue(false);

      const resultPromise = waitForAuthStability('test-context', 200);

      await vi.advanceTimersByTimeAsync(250);
      const result = await resultPromise;

      expect(result).toBe(false);
    });

    it('should use default timeout of 3000ms', async () => {
      vi.mocked(sessionCache.isAuthStable).mockReturnValue(false);

      const resultPromise = waitForAuthStability('test-context');

      await vi.advanceTimersByTimeAsync(3100);
      const result = await resultPromise;

      expect(result).toBe(false);
    });
  });

  describe('waitForValidation', () => {
    it('should return true immediately if validation is complete', async () => {
      vi.mocked(startupSessionValidator.isValidationComplete).mockReturnValue(true);

      const result = await waitForValidation('test-context');

      expect(result).toBe(true);
    });

    it('should poll until validation completes', async () => {
      vi.mocked(startupSessionValidator.isValidationComplete)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);

      const resultPromise = waitForValidation('test-context', 5000);

      await vi.advanceTimersByTimeAsync(250);
      const result = await resultPromise;

      expect(result).toBe(true);
    });

    it('should return false on timeout', async () => {
      vi.mocked(startupSessionValidator.isValidationComplete).mockReturnValue(false);

      const resultPromise = waitForValidation('test-context', 200);

      // Advance past polling interval (100ms) multiple times until timeout
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);
      const result = await resultPromise;

      expect(result).toBe(false);
    });

    it('should use default timeout of 15000ms', async () => {
      vi.mocked(startupSessionValidator.isValidationComplete).mockReturnValue(false);

      const resultPromise = waitForValidation('test-context');

      await vi.advanceTimersByTimeAsync(15100);
      const result = await resultPromise;

      expect(result).toBe(false);
    });
  });

  describe('safeQuery', () => {
    // checkForAuthTokens reads Object.keys(localStorage), so the token key is set as a
    // property on the shared localStorage mock.
    const TOKEN_KEY = 'sb-project-auth-token';
    const storage = localStorage as unknown as Record<string, unknown>;

    beforeEach(() => {
      vi.mocked(startupSessionValidator.isValidationComplete).mockReturnValue(true);
      vi.mocked(sessionCache.isAuthStable).mockReturnValue(true);
      storage[TOKEN_KEY] = 'token';
    });

    afterEach(() => {
      delete storage[TOKEN_KEY];
    });

    it('returns the query result once validation and auth are settled', async () => {
      const result = await safeQuery(() => Promise.resolve([1, 2]), { context: 'ok' });

      expect(result).toEqual({ data: [1, 2], error: null, wasAborted: false });
    });

    it('still runs the query when validation never completes', async () => {
      vi.mocked(startupSessionValidator.isValidationComplete).mockReturnValue(false);
      const queryFn = vi.fn().mockResolvedValue('data');

      const resultPromise = safeQuery(queryFn, { context: 'slow-validation' });
      await vi.advanceTimersByTimeAsync(10200);
      const result = await resultPromise;

      expect(queryFn).toHaveBeenCalled();
      expect(result.data).toBe('data');
    });

    it('returns an error without running the query when there are no auth tokens', async () => {
      delete storage[TOKEN_KEY];
      const queryFn = vi.fn();

      const result = await safeQuery(queryFn, { context: 'signed-out' });

      expect(queryFn).not.toHaveBeenCalled();
      expect(result.error?.message).toBe('No authentication tokens available. Please sign in again.');
      expect(result.wasAborted).toBe(false);
    });

    it('skips the validation wait and token check when asked', async () => {
      delete storage[TOKEN_KEY];

      const result = await safeQuery(() => Promise.resolve('public'), {
        context: 'public',
        skipValidationCheck: true,
      });

      expect(startupSessionValidator.isValidationComplete).not.toHaveBeenCalled();
      expect(result.data).toBe('public');
    });

    it('marks the result as aborted when the query times out', async () => {
      const resultPromise = safeQuery(() => new Promise(() => {}), { context: 'hang', timeout: 500 });
      await vi.advanceTimersByTimeAsync(600);
      const result = await resultPromise;

      expect(result.wasAborted).toBe(true);
      expect(result.error?.message).toBe('Query timeout after 500ms: hang');
    });

    it('returns the query error without marking it aborted', async () => {
      const result = await safeQuery(() => Promise.reject(new Error('db down')), { context: 'fail' });

      expect(result).toEqual({ data: null, error: new Error('db down'), wasAborted: false });
    });

    it('wraps a non-Error rejection in an Error', async () => {
      const result = await safeQuery(() => Promise.reject('plain string'), { context: 'string' });

      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toBe('plain string');
    });

    it('returns an error result when the validation check itself throws', async () => {
      vi.mocked(startupSessionValidator.isValidationComplete).mockImplementation(() => {
        throw 'validator crashed';
      });

      const result = await safeQuery(() => Promise.resolve('never'), { context: 'crash' });

      expect(result.data).toBeNull();
      expect(result.error?.message).toBe('validator crashed');
      expect(result.wasAborted).toBe(false);
    });
  });

  describe('createQueryWrapper', () => {
    it('uses the default context and options', async () => {
      const wrapped = createQueryWrapper('default-ctx', { skipValidationCheck: true, timeout: 200 });

      const resultPromise = wrapped(() => new Promise(() => {}));
      await vi.advanceTimersByTimeAsync(300);
      const result = await resultPromise;

      expect(result.error?.message).toBe('Query timeout after 200ms: default-ctx');
    });

    it('lets a call override the context', async () => {
      const wrapped = createQueryWrapper('default-ctx', { skipValidationCheck: true, timeout: 200 });

      const resultPromise = wrapped(() => new Promise(() => {}), 'override-ctx');
      await vi.advanceTimersByTimeAsync(300);
      const result = await resultPromise;

      expect(result.error?.message).toBe('Query timeout after 200ms: override-ctx');
    });
  });
});
