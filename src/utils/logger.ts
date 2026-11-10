/**
 * Configurable Logging Utility
 *
 * Provides structured logging with category-based filtering.
 * Disabled by default in production builds.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogCategory = 'auth' | 'session' | 'spotify' | 'token' | 'general';

interface LogConfig {
  enabled: boolean;
  minLevel: LogLevel;
  enabledCategories: LogCategory[];
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

class Logger {
  private config: LogConfig = {
    enabled: import.meta.env.DEV,
    minLevel: 'info',
    enabledCategories: ['auth', 'session', 'spotify', 'token', 'general']
  };

  /**
   * Configure the logger
   */
  configure(config: Partial<LogConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Enable or disable logging
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * Set minimum log level
   */
  setMinLevel(level: LogLevel): void {
    this.config.minLevel = level;
  }

  /**
   * Enable specific categories
   */
  setCategories(categories: LogCategory[]): void {
    this.config.enabledCategories = categories;
  }

  private shouldLog(level: LogLevel, category: LogCategory): boolean {
    if (!this.config.enabled) return false;
    if (LOG_LEVELS[level] < LOG_LEVELS[this.config.minLevel]) return false;
    if (!this.config.enabledCategories.includes(category)) return false;
    return true;
  }

  private formatMessage(category: LogCategory, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${category.toUpperCase()}] ${message}`;
  }

  private log(level: LogLevel, category: LogCategory, message: string, data?: object): void {
    if (!this.shouldLog(level, category)) return;

    const formattedMessage = this.formatMessage(category, message);
    const args = data ? [formattedMessage, data] : [formattedMessage];

    switch (level) {
      case 'debug':
        console.debug(...args);
        break;
      case 'info':
        console.log(...args);
        break;
      case 'warn':
        console.warn(...args);
        break;
      case 'error':
        console.error(...args);
        break;
    }
  }

  // Category-specific logging methods

  /**
   * Log authentication-related messages
   */
  auth(message: string, data?: object, level: LogLevel = 'info'): void {
    this.log(level, 'auth', message, data);
  }

  /**
   * Log session-related messages
   */
  session(message: string, data?: object, level: LogLevel = 'info'): void {
    this.log(level, 'session', message, data);
  }

  /**
   * Log Spotify-related messages
   */
  spotify(message: string, data?: object, level: LogLevel = 'info'): void {
    this.log(level, 'spotify', message, data);
  }

  /**
   * Log token-related messages
   */
  token(message: string, data?: object, level: LogLevel = 'info'): void {
    this.log(level, 'token', message, data);
  }

  /**
   * Log general messages
   */
  general(message: string, data?: object, level: LogLevel = 'info'): void {
    this.log(level, 'general', message, data);
  }

  // Convenience methods for different log levels

  debug(category: LogCategory, message: string, data?: object): void {
    this.log('debug', category, message, data);
  }

  info(category: LogCategory, message: string, data?: object): void {
    this.log('info', category, message, data);
  }

  warn(category: LogCategory, message: string, data?: object): void {
    this.log('warn', category, message, data);
  }

  error(category: LogCategory, message: string, data?: object): void {
    this.log('error', category, message, data);
  }
}

// Export singleton instance
export const logger = new Logger();

// Export types for external use
export type { LogLevel, LogCategory, LogConfig };
