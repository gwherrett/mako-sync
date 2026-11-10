import { supabase } from '@/integrations/supabase/client';
import { ErrorClassification, ErrorContext } from './errorHandling.service';
import { errorFields } from '@/utils/errorUtils';

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: 'debug' | 'info' | 'warn' | 'error' | 'critical';
  category: string;
  message: string;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string | number;
  };
  context: ErrorContext;
  classification?: ErrorClassification;
  userId?: string;
  sessionId?: string;
  fingerprint: string; // For deduplication
  tags: string[];
  metadata: Record<string, unknown>;
}

/** A LogEntry as saved in localStorage, where the timestamp is an ISO string. */
type StoredLogEntry = Omit<LogEntry, 'timestamp'> & { timestamp: string };

export interface LoggingConfig {
  enableConsoleLogging: boolean;
  enableRemoteLogging: boolean;
  enableLocalStorage: boolean;
  maxLocalStorageEntries: number;
  logLevels: LogEntry['level'][];
  enableDeduplication: boolean;
  deduplicationWindow: number; // milliseconds
  enableSampling: boolean;
  samplingRate: number; // 0-1
}

export interface LogMetrics {
  totalLogs: number;
  logsByLevel: Record<LogEntry['level'], number>;
  logsByCategory: Record<string, number>;
  recentErrors: LogEntry[];
  errorRate: number; // errors per minute
  lastLogTime: Date | null;
}

export interface AlertRule {
  id: string;
  name: string;
  condition: (entry: LogEntry, metrics: LogMetrics) => boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  enabled: boolean;
  cooldown: number; // milliseconds
  lastTriggered?: Date;
}

export class ErrorLoggingService {
  private static readonly STORAGE_KEY = 'mako_error_logs';
  private static readonly METRICS_KEY = 'mako_log_metrics';
  private static readonly DEFAULT_CONFIG: LoggingConfig = {
    enableConsoleLogging: true,
    enableRemoteLogging: false, // Would be enabled in production
    enableLocalStorage: true,
    maxLocalStorageEntries: 1000,
    logLevels: ['info', 'warn', 'error', 'critical'],
    enableDeduplication: true,
    deduplicationWindow: 60000, // 1 minute
    enableSampling: false,
    samplingRate: 1.0
  };

  private static config: LoggingConfig = this.DEFAULT_CONFIG;
  private static logBuffer: LogEntry[] = [];
  private static metrics: LogMetrics = this.initializeMetrics();
  private static alertRules: AlertRule[] = this.getDefaultAlertRules();
  private static recentFingerprints: Map<string, Date> = new Map();

  /**
   * Initialize the logging service
   */
  static initialize(config: Partial<LoggingConfig> = {}): void {
    this.config = { ...this.DEFAULT_CONFIG, ...config };
    this.loadStoredLogs();
    this.loadStoredMetrics();
    
    // Setup periodic cleanup
    setInterval(() => this.cleanup(), 5 * 60 * 1000); // Every 5 minutes
    
    console.log('Error logging service initialized', this.config);
  }

  /**
   * Log an error with comprehensive context
   */
  static logError(
    error: unknown,
    context: Partial<ErrorContext> = {},
    classification?: ErrorClassification
  ): void {
    const { name, message, stack, code } = errorFields(error);
    this.log('error', 'error', message, {
      error: {
        name: name || 'Error',
        message,
        stack,
        code
      },
      context: this.enrichContext(context),
      classification
    });
  }

  /**
   * Log authentication events
   */
  static logAuthEvent(
    event: string,
    level: LogEntry['level'] = 'info',
    context: Partial<ErrorContext> = {},
    metadata: Record<string, unknown> = {}
  ): void {
    this.log(level, 'auth', event, {
      context: this.enrichContext(context),
      metadata: {
        ...metadata,
        eventType: 'auth'
      }
    });
  }

  /**
   * Log Spotify-related events
   */
  static logSpotifyEvent(
    event: string,
    level: LogEntry['level'] = 'info',
    context: Partial<ErrorContext> = {},
    metadata: Record<string, unknown> = {}
  ): void {
    this.log(level, 'spotify', event, {
      context: this.enrichContext(context),
      metadata: {
        ...metadata,
        eventType: 'spotify'
      }
    });
  }


  /**
   * Core logging method
   */
  private static log(
    level: LogEntry['level'],
    category: string,
    message: string,
    data: Partial<LogEntry> = {}
  ): void {
    // Check if this log level is enabled
    if (!this.config.logLevels.includes(level)) {
      return;
    }

    // Apply sampling if enabled
    if (this.config.enableSampling && Math.random() > this.config.samplingRate) {
      return;
    }

    const entry: LogEntry = {
      id: this.generateId(),
      timestamp: new Date(),
      level,
      category,
      message,
      fingerprint: this.generateFingerprint(level, category, message, data.error),
      tags: this.generateTags(level, category, data.context, data.classification),
      userId: data.context?.userId,
      sessionId: data.context?.sessionId,
      context: data.context || this.createDefaultContext(),
      metadata: data.metadata || {},
      ...data
    };

    // Check for deduplication
    if (this.config.enableDeduplication && this.isDuplicate(entry)) {
      return;
    }

    // Add to buffer and metrics
    this.logBuffer.push(entry);
    this.updateMetrics(entry);

    // Console logging
    if (this.config.enableConsoleLogging) {
      this.logToConsole(entry);
    }

    // Local storage
    if (this.config.enableLocalStorage) {
      this.saveToLocalStorage();
    }

    // Remote logging (would be implemented for production)
    if (this.config.enableRemoteLogging) {
      this.sendToRemoteService(entry);
    }

    // Check alert rules
    this.checkAlertRules(entry);

    // Cleanup buffer if too large
    if (this.logBuffer.length > this.config.maxLocalStorageEntries) {
      this.logBuffer = this.logBuffer.slice(-this.config.maxLocalStorageEntries);
    }
  }

  /**
   * Generate unique fingerprint for deduplication
   */
  private static generateFingerprint(
    level: string,
    category: string,
    message: string,
    error?: LogEntry['error']
  ): string {
    const components = [
      level,
      category,
      message.substring(0, 100), // First 100 chars
      error?.name || '',
      error?.code || ''
    ];
    
    return btoa(components.join('|')).substring(0, 16);
  }

  /**
   * Check if log entry is a duplicate
   */
  private static isDuplicate(entry: LogEntry): boolean {
    const lastSeen = this.recentFingerprints.get(entry.fingerprint);
    const now = new Date();
    
    if (lastSeen && (now.getTime() - lastSeen.getTime()) < this.config.deduplicationWindow) {
      return true;
    }
    
    this.recentFingerprints.set(entry.fingerprint, now);
    return false;
  }

  /**
   * Generate tags for categorization
   */
  private static generateTags(
    level: string,
    category: string,
    context?: ErrorContext,
    classification?: ErrorClassification
  ): string[] {
    const tags = [level, category];
    
    if (classification) {
      tags.push(
        `severity:${classification.severity}`,
        `retryable:${classification.isRetryable}`,
        `user-actionable:${classification.isUserActionable}`
      );
    }
    
    if (context?.component) {
      tags.push(`component:${context.component}`);
    }
    
    if (context?.operation) {
      tags.push(`operation:${context.operation}`);
    }
    
    return tags;
  }

  /**
   * Enrich context with additional information
   */
  private static enrichContext(context: Partial<ErrorContext>): ErrorContext {
    return {
      operation: 'unknown',
      timestamp: new Date(),
      userAgent: navigator.userAgent,
      url: window.location.href,
      ...context
    };
  }

  /**
   * Create default context
   */
  private static createDefaultContext(): ErrorContext {
    return {
      operation: 'unknown',
      timestamp: new Date(),
      userAgent: navigator.userAgent,
      url: window.location.href
    };
  }

  /**
   * Console logging with formatting
   */
  private static logToConsole(entry: LogEntry): void {
    const prefix = `[${entry.timestamp.toISOString()}] [${entry.level.toUpperCase()}] [${entry.category}]`;
    const message = `${prefix} ${entry.message}`;
    
    switch (entry.level) {
      case 'critical':
      case 'error':
        console.error(message, entry);
        break;
      case 'warn':
        console.warn(message, entry);
        break;
      case 'info':
        console.info(message, entry);
        break;
      case 'debug':
        console.debug(message, entry);
        break;
    }
  }

  /**
   * Save logs to local storage
   */
  private static saveToLocalStorage(): void {
    try {
      const recentLogs = this.logBuffer.slice(-this.config.maxLocalStorageEntries);
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(recentLogs));
      localStorage.setItem(this.METRICS_KEY, JSON.stringify(this.metrics));
    } catch (error) {
      console.warn('Failed to save logs to localStorage:', error);
    }
  }

  /**
   * Load logs from local storage
   */
  private static loadStoredLogs(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        this.logBuffer = JSON.parse(stored).map((entry: StoredLogEntry) => ({
          ...entry,
          timestamp: new Date(entry.timestamp)
        }));
      }
    } catch (error) {
      console.warn('Failed to load stored logs:', error);
      this.logBuffer = [];
    }
  }

  /**
   * Load metrics from local storage
   */
  private static loadStoredMetrics(): void {
    try {
      const stored = localStorage.getItem(this.METRICS_KEY);
      if (stored) {
        const metrics = JSON.parse(stored);
        this.metrics = {
          ...metrics,
          lastLogTime: metrics.lastLogTime ? new Date(metrics.lastLogTime) : null
        };
      }
    } catch (error) {
      console.warn('Failed to load stored metrics:', error);
      this.metrics = this.initializeMetrics();
    }
  }

  /**
   * Send to remote logging service (placeholder)
   */
  private static async sendToRemoteService(entry: LogEntry): Promise<void> {
    // In production, this would send to your logging service
    // For now, we'll just log that it would be sent
    console.debug('Would send to remote logging service:', entry);
    
    // Example implementation:
    // try {
    //   await fetch('/api/logs', {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify(entry)
    //   });
    // } catch (error) {
    //   console.error('Failed to send log to remote service:', error);
    // }
  }

  /**
   * Update metrics
   */
  private static updateMetrics(entry: LogEntry): void {
    this.metrics.totalLogs++;
    this.metrics.logsByLevel[entry.level] = (this.metrics.logsByLevel[entry.level] || 0) + 1;
    this.metrics.logsByCategory[entry.category] = (this.metrics.logsByCategory[entry.category] || 0) + 1;
    this.metrics.lastLogTime = entry.timestamp;
    
    // Add to recent errors if it's an error
    if (entry.level === 'error' || entry.level === 'critical') {
      this.metrics.recentErrors.unshift(entry);
      this.metrics.recentErrors = this.metrics.recentErrors.slice(0, 50); // Keep last 50
    }
    
    // Calculate error rate (errors per minute)
    const oneMinuteAgo = new Date(Date.now() - 60000);
    const recentErrors = this.metrics.recentErrors.filter(e => e.timestamp >= oneMinuteAgo);
    this.metrics.errorRate = recentErrors.length;
  }

  /**
   * Initialize metrics
   */
  private static initializeMetrics(): LogMetrics {
    return {
      totalLogs: 0,
      logsByLevel: {
        debug: 0,
        info: 0,
        warn: 0,
        error: 0,
        critical: 0
      },
      logsByCategory: {},
      recentErrors: [],
      errorRate: 0,
      lastLogTime: null
    };
  }

  /**
   * Get default alert rules
   */
  private static getDefaultAlertRules(): AlertRule[] {
    return [
      {
        id: 'high_error_rate',
        name: 'High Error Rate',
        condition: (entry, metrics) => metrics.errorRate > 10,
        severity: 'high',
        enabled: true,
        cooldown: 300000 // 5 minutes
      },
      {
        id: 'critical_error',
        name: 'Critical Error',
        condition: (entry) => entry.level === 'critical',
        severity: 'critical',
        enabled: true,
        cooldown: 60000 // 1 minute
      },
      {
        id: 'auth_failures',
        name: 'Authentication Failures',
        condition: (entry) => entry.category === 'auth' && entry.level === 'error',
        severity: 'medium',
        enabled: true,
        cooldown: 180000 // 3 minutes
      }
    ];
  }

  /**
   * Check alert rules
   */
  private static checkAlertRules(entry: LogEntry): void {
    const now = new Date();
    
    for (const rule of this.alertRules) {
      if (!rule.enabled) continue;
      
      // Check cooldown
      if (rule.lastTriggered && (now.getTime() - rule.lastTriggered.getTime()) < rule.cooldown) {
        continue;
      }
      
      // Check condition
      if (rule.condition(entry, this.metrics)) {
        rule.lastTriggered = now;
        this.triggerAlert(rule, entry);
      }
    }
  }

  /**
   * Trigger alert
   */
  private static triggerAlert(rule: AlertRule, entry: LogEntry): void {
    console.warn(`ALERT TRIGGERED: ${rule.name}`, { rule, entry });
    
    // In production, you would send this to your alerting system
    // For now, we'll just log it
  }

  /**
   * Cleanup old data
   */
  private static cleanup(): void {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
    
    // Clean fingerprints
    for (const [fingerprint, timestamp] of this.recentFingerprints.entries()) {
      if (timestamp < cutoff) {
        this.recentFingerprints.delete(fingerprint);
      }
    }
    
    // Clean recent errors in metrics
    this.metrics.recentErrors = this.metrics.recentErrors.filter(
      error => error.timestamp >= cutoff
    );
  }


  static getMetrics(): LogMetrics {
    return { ...this.metrics };
  }

  static clearLogs(): void {
    this.logBuffer = [];
    this.metrics = this.initializeMetrics();
    localStorage.removeItem(this.STORAGE_KEY);
    localStorage.removeItem(this.METRICS_KEY);
    console.log('All logs cleared');
  }

  static exportLogs(): string {
    return JSON.stringify(this.logBuffer, null, 2);
  }

  /**
   * Utility methods
   */
  private static generateId(): string {
    return `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export default ErrorLoggingService;