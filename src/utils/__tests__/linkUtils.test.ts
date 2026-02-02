import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { copyToClipboard, isInIframe, isPopupBlocked } from '../linkUtils';

// Mock the toast hook
vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn()
}));

describe('linkUtils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('copyToClipboard', () => {
    it('should copy text using modern clipboard API when available', async () => {
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextMock },
        configurable: true
      });
      Object.defineProperty(window, 'isSecureContext', {
        value: true,
        configurable: true
      });

      const result = await copyToClipboard('test text');

      expect(result).toBe(true);
      expect(writeTextMock).toHaveBeenCalledWith('test text');
    });

    it('should return false and log error when an exception occurs', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: vi.fn().mockRejectedValue(new Error('Permission denied'))
        },
        configurable: true
      });
      Object.defineProperty(window, 'isSecureContext', {
        value: true,
        configurable: true
      });

      const result = await copyToClipboard('text');

      expect(result).toBe(false);
      expect(console.error).toHaveBeenCalledWith('Failed to copy to clipboard:', expect.any(Error));
    });
  });

  describe('isInIframe', () => {
    it('should return false when not in iframe', () => {
      // When window.self equals window.top, not in iframe
      Object.defineProperty(window, 'self', { value: window, configurable: true });
      Object.defineProperty(window, 'top', { value: window, configurable: true });

      expect(isInIframe()).toBe(false);
    });

    it('should return true when in iframe', () => {
      const mockTop = {} as Window;
      Object.defineProperty(window, 'self', { value: window, configurable: true });
      Object.defineProperty(window, 'top', { value: mockTop, configurable: true });

      expect(isInIframe()).toBe(true);
    });

    it('should return true when accessing window.top throws', () => {
      Object.defineProperty(window, 'self', { value: window, configurable: true });
      Object.defineProperty(window, 'top', {
        get() { throw new Error('cross-origin'); },
        configurable: true
      });

      expect(isInIframe()).toBe(true);
    });
  });

  describe('isPopupBlocked', () => {
    it('should return true when in iframe', () => {
      const mockTop = {} as Window;
      Object.defineProperty(window, 'self', { value: window, configurable: true });
      Object.defineProperty(window, 'top', { value: mockTop, configurable: true });

      expect(isPopupBlocked()).toBe(true);
    });

    it('should return false when not in iframe', () => {
      Object.defineProperty(window, 'self', { value: window, configurable: true });
      Object.defineProperty(window, 'top', { value: window, configurable: true });

      expect(isPopupBlocked()).toBe(false);
    });
  });
});
