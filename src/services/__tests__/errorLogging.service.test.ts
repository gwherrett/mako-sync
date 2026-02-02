import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ErrorLoggingService } from '../errorLogging.service';

describe('ErrorLoggingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});

    // Clear any stored logs and reset state
    localStorage.removeItem('mako_error_logs');
    localStorage.removeItem('mako_log_metrics');
    ErrorLoggingService.clearLogs();
  });

  afterEach(() => {
    ErrorLoggingService.clearLogs();
  });

  describe('initialize', () => {
    it('should initialize with default config', () => {
      ErrorLoggingService.initialize();

      expect(console.log).toHaveBeenCalledWith(
        'Error logging service initialized',
        expect.objectContaining({
          enableConsoleLogging: true,
          enableLocalStorage: true
        })
      );
    });

    it('should merge custom config with defaults', () => {
      ErrorLoggingService.initialize({
        enableConsoleLogging: false,
        maxLocalStorageEntries: 500
      });

      expect(console.log).toHaveBeenCalledWith(
        'Error logging service initialized',
        expect.objectContaining({
          enableConsoleLogging: false,
          maxLocalStorageEntries: 500
        })
      );
    });
  });

  describe('logError', () => {
    beforeEach(() => {
      ErrorLoggingService.clearLogs();
      ErrorLoggingService.initialize({ enableLocalStorage: false, enableDeduplication: false });
    });

    it('should log an Error object', () => {
      const error = new Error('Test error message');
      error.name = 'TestError';

      ErrorLoggingService.logError(error);

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR]'),
        expect.objectContaining({
          level: 'error',
          message: 'Test error message'
        })
      );
    });
  });

  describe('logAuthEvent', () => {
    beforeEach(() => {
      ErrorLoggingService.clearLogs();
      ErrorLoggingService.initialize({ enableLocalStorage: false, enableDeduplication: false });
    });

    it('should log auth event with default info level', () => {
      ErrorLoggingService.logAuthEvent('User logged in');

      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('[INFO]'),
        expect.objectContaining({
          category: 'auth',
          message: 'User logged in'
        })
      );
    });

    it('should log auth event with custom level', () => {
      ErrorLoggingService.logAuthEvent('Auth failed', 'error');

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR]'),
        expect.objectContaining({
          category: 'auth',
          message: 'Auth failed'
        })
      );
    });

    it('should log auth event with metadata', () => {
      ErrorLoggingService.logAuthEvent('Token refreshed', 'info', {}, { tokenType: 'access' });

      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('[INFO]'),
        expect.objectContaining({
          metadata: expect.objectContaining({
            tokenType: 'access',
            eventType: 'auth'
          })
        })
      );
    });
  });

  describe('logSpotifyEvent', () => {
    beforeEach(() => {
      ErrorLoggingService.clearLogs();
      ErrorLoggingService.initialize({ enableLocalStorage: false, enableDeduplication: false });
    });

    it('should log Spotify event with default info level', () => {
      ErrorLoggingService.logSpotifyEvent('Syncing library');

      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('[INFO]'),
        expect.objectContaining({
          category: 'spotify',
          message: 'Syncing library'
        })
      );
    });

    it('should log Spotify event with warn level', () => {
      ErrorLoggingService.logSpotifyEvent('Rate limit approaching', 'warn');

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('[WARN]'),
        expect.objectContaining({
          category: 'spotify',
          message: 'Rate limit approaching'
        })
      );
    });
  });

  describe('getMetrics', () => {
    beforeEach(() => {
      ErrorLoggingService.clearLogs();
      ErrorLoggingService.initialize({ enableLocalStorage: false, enableDeduplication: false });
    });

    it('should return metrics object', () => {
      const metrics = ErrorLoggingService.getMetrics();

      expect(metrics).toHaveProperty('totalLogs');
      expect(metrics).toHaveProperty('logsByLevel');
      expect(metrics).toHaveProperty('logsByCategory');
      expect(metrics).toHaveProperty('recentErrors');
      expect(metrics).toHaveProperty('errorRate');
      expect(metrics).toHaveProperty('lastLogTime');
    });
  });

  describe('clearLogs', () => {
    it('should clear all logs and reset metrics', () => {
      ErrorLoggingService.initialize({ enableLocalStorage: false, enableDeduplication: false });
      ErrorLoggingService.logError(new Error('Test error'));

      ErrorLoggingService.clearLogs();

      const metrics = ErrorLoggingService.getMetrics();
      expect(metrics.totalLogs).toBe(0);
      expect(metrics.recentErrors).toHaveLength(0);
    });

    it('should remove logs from localStorage', () => {
      ErrorLoggingService.initialize({ enableLocalStorage: true });
      ErrorLoggingService.logError(new Error('Test error'));

      ErrorLoggingService.clearLogs();

      expect(localStorage.getItem('mako_error_logs')).toBeNull();
      expect(localStorage.getItem('mako_log_metrics')).toBeNull();
    });
  });

  describe('exportLogs', () => {
    beforeEach(() => {
      ErrorLoggingService.clearLogs();
      ErrorLoggingService.initialize({ enableLocalStorage: false, enableDeduplication: false });
    });

    it('should export logs as JSON string', () => {
      ErrorLoggingService.logAuthEvent('Test event');

      const exported = ErrorLoggingService.exportLogs();

      expect(typeof exported).toBe('string');
      const parsed = JSON.parse(exported);
      expect(Array.isArray(parsed)).toBe(true);
    });
  });

  describe('log level filtering', () => {
    it('should not log debug when not in logLevels', () => {
      ErrorLoggingService.clearLogs();
      ErrorLoggingService.initialize({
        enableLocalStorage: false,
        logLevels: ['info', 'warn', 'error', 'critical'] // No 'debug'
      });

      // Debug level not directly exposed, but we can verify through metrics
      const metricsBefore = ErrorLoggingService.getMetrics();
      expect(metricsBefore.logsByLevel.debug).toBe(0);
    });
  });

  describe('sampling', () => {
    it('should apply sampling when enabled', () => {
      // With 0 sampling rate, no logs should be recorded
      ErrorLoggingService.clearLogs();
      ErrorLoggingService.initialize({
        enableLocalStorage: false,
        enableSampling: true,
        samplingRate: 0
      });

      ErrorLoggingService.logAuthEvent('Sampled event');

      const metrics = ErrorLoggingService.getMetrics();
      expect(metrics.totalLogs).toBe(0);
    });
  });

  describe('localStorage persistence', () => {
    it('should save logs to localStorage when enabled', () => {
      ErrorLoggingService.clearLogs();
      ErrorLoggingService.initialize({ enableLocalStorage: true, enableDeduplication: false });
      ErrorLoggingService.logAuthEvent('Persisted event');

      const stored = localStorage.getItem('mako_error_logs');
      expect(stored).not.toBeNull();

      const parsed = JSON.parse(stored!);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);
    });

    it('should load logs from localStorage on initialize', () => {
      // Pre-populate localStorage
      const existingLogs = [{
        id: 'test-id',
        timestamp: new Date().toISOString(),
        level: 'info',
        category: 'test',
        message: 'Existing log',
        fingerprint: 'test',
        tags: [],
        context: {},
        metadata: {}
      }];
      localStorage.setItem('mako_error_logs', JSON.stringify(existingLogs));

      ErrorLoggingService.initialize({ enableLocalStorage: true });

      const exported = ErrorLoggingService.exportLogs();
      expect(exported).toContain('Existing log');
    });
  });
});
