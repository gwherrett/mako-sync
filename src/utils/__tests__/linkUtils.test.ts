import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { copyToClipboard, isInIframe, isPopupBlocked, openInNewTab } from '../linkUtils';
import { toast } from '@/hooks/use-toast';

// Mock the toast hook
vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn()
}));

const mockToast = vi.mocked(toast);

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

  describe('openInNewTab', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // Setup minimal DOM mocks
      vi.stubGlobal('document', {
        createElement: vi.fn().mockReturnValue({
          href: '',
          target: '',
          rel: '',
          click: vi.fn()
        }),
        body: {
          appendChild: vi.fn(),
          removeChild: vi.fn()
        }
      });
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it('should return true when window.open succeeds', async () => {
      const mockWindow = { closed: false } as Window;
      vi.stubGlobal('window', {
        open: vi.fn().mockReturnValue(mockWindow)
      });

      const result = await openInNewTab({ url: 'https://example.com' });

      expect(result).toBe(true);
      expect(window.open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
    });

    it('should handle window.open throwing an error', async () => {
      vi.stubGlobal('window', {
        open: vi.fn().mockImplementation(() => {
          throw new Error('Popup blocked');
        }),
        isSecureContext: true
      });
      vi.stubGlobal('navigator', {
        clipboard: { writeText: vi.fn().mockResolvedValue(undefined) }
      });

      const onFallback = vi.fn();
      const result = await openInNewTab({ url: 'https://example.com', onFallback });

      expect(result).toBe(false);
      expect(onFallback).toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Unable to Open Link',
        variant: 'destructive'
      }));
    });

    it('should use fallback when window.open returns null', async () => {
      vi.stubGlobal('window', {
        open: vi.fn().mockReturnValue(null),
        isSecureContext: true
      });
      vi.stubGlobal('navigator', {
        clipboard: { writeText: vi.fn().mockResolvedValue(undefined) }
      });

      const onFallback = vi.fn();
      const resultPromise = openInNewTab({ url: 'https://example.com', onFallback });

      // Advance timer to trigger setTimeout
      await vi.advanceTimersByTimeAsync(150);

      const result = await resultPromise;

      expect(result).toBe(false);
      expect(document.body.appendChild).toHaveBeenCalled();
    });

    it('should use fallback when window.open returns closed window', async () => {
      const mockWindow = { closed: true } as Window;
      vi.stubGlobal('window', {
        open: vi.fn().mockReturnValue(mockWindow),
        isSecureContext: true
      });
      vi.stubGlobal('navigator', {
        clipboard: { writeText: vi.fn().mockResolvedValue(undefined) }
      });

      const resultPromise = openInNewTab({ url: 'https://example.com' });
      await vi.advanceTimersByTimeAsync(150);

      const result = await resultPromise;

      expect(result).toBe(false);
    });

    it('should use fallback when window closed property is undefined', async () => {
      const mockWindow = {} as Window; // closed is undefined
      vi.stubGlobal('window', {
        open: vi.fn().mockReturnValue(mockWindow),
        isSecureContext: true
      });
      vi.stubGlobal('navigator', {
        clipboard: { writeText: vi.fn().mockResolvedValue(undefined) }
      });

      const resultPromise = openInNewTab({ url: 'https://example.com' });
      await vi.advanceTimersByTimeAsync(150);

      const result = await resultPromise;

      expect(result).toBe(false);
    });
  });
});
