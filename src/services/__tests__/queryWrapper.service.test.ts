import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForAuthStability, waitForValidation } from '../queryWrapper.service';
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
});
