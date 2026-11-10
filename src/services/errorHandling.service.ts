import { AuthError } from '@supabase/supabase-js';
import { useToast } from '@/hooks/use-toast';
import { errorFields } from '@/utils/errorUtils';

export interface ErrorContext {
  operation: string;
  component?: string;
  userId?: string;
  sessionId?: string;
  timestamp: Date;
  userAgent?: string;
  url?: string;
  additionalData?: Record<string, unknown>;
}

export interface ErrorClassification {
  category: 'auth' | 'network' | 'validation' | 'permission' | 'system' | 'spotify' | 'unknown';
  severity: 'low' | 'medium' | 'high' | 'critical';
  isRetryable: boolean;
  isUserActionable: boolean;
  requiresReauth: boolean;
}

export interface ErrorHandlingResult {
  handled: boolean;
  userMessage: string;
  shouldRetry: boolean;
  retryDelay?: number;
  requiresReauth: boolean;
  logLevel: 'info' | 'warn' | 'error' | 'critical';
}

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableErrors: string[];
}

export class ErrorHandlingService {
  private static readonly DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    retryableErrors: [
      'network_error',
      'timeout',
      'rate_limit',
      'temporary_unavailable',
      'service_unavailable',
      'too_many_requests'
    ]
  };

  /**
   * Comprehensive error classification system
   */
  static classifyError(error: unknown): ErrorClassification {
    const fields = errorFields(error);
    const message = fields.message?.toLowerCase() || '';
    const code = fields.code || fields.status || '';
    // Relational checks coerce the code to a number, so a numeric string like '503' counts.
    const numericCode = Number(code);

    // Auth-related errors
    if (this.isAuthError(error) || message.includes('auth') || message.includes('session')) {
      return {
        category: 'auth',
        severity: this.getAuthErrorSeverity(message),
        isRetryable: this.isRetryableAuthError(message),
        isUserActionable: true,
        requiresReauth: this.requiresReauth(message)
      };
    }

    // Network errors
    if (this.isNetworkError(error) || message.includes('network') || message.includes('fetch')) {
      return {
        category: 'network',
        severity: 'medium',
        isRetryable: true,
        isUserActionable: false,
        requiresReauth: false
      };
    }

    // Spotify-specific errors
    if (message.includes('spotify') || message.includes('token') || code === 401) {
      return {
        category: 'spotify',
        severity: this.getSpotifyErrorSeverity(message, code),
        isRetryable: this.isRetryableSpotifyError(message, code),
        isUserActionable: true,
        requiresReauth: message.includes('invalid_grant') || message.includes('unauthorized')
      };
    }

    // Validation errors
    if (message.includes('validation') || message.includes('invalid') || numericCode >= 400 && numericCode < 500) {
      return {
        category: 'validation',
        severity: 'low',
        isRetryable: false,
        isUserActionable: true,
        requiresReauth: false
      };
    }

    // Permission errors
    if (message.includes('permission') || message.includes('forbidden') || code === 403) {
      return {
        category: 'permission',
        severity: 'high',
        isRetryable: false,
        isUserActionable: true,
        requiresReauth: true
      };
    }

    // System errors
    if (message.includes('system') || message.includes('internal') || numericCode >= 500) {
      return {
        category: 'system',
        severity: 'high',
        isRetryable: true,
        isUserActionable: false,
        requiresReauth: false
      };
    }

    // Default classification
    return {
      category: 'unknown',
      severity: 'medium',
      isRetryable: false,
      isUserActionable: false,
      requiresReauth: false
    };
  }

  /**
   * Generate user-friendly error messages with actionable guidance
   */
  static generateUserMessage(error: unknown, classification: ErrorClassification): string {
    const message = errorFields(error).message?.toLowerCase() || '';

    // Auth error messages
    if (classification.category === 'auth') {
      return this.getAuthErrorMessage(message);
    }

    // Network error messages
    if (classification.category === 'network') {
      return this.getNetworkErrorMessage(message);
    }

    // Spotify error messages
    if (classification.category === 'spotify') {
      return this.getSpotifyErrorMessage(message);
    }

    // Validation error messages
    if (classification.category === 'validation') {
      return this.getValidationErrorMessage(message);
    }

    // Permission error messages
    if (classification.category === 'permission') {
      return 'You don\'t have permission to perform this action. Please contact support if you believe this is an error.';
    }

    // System error messages
    if (classification.category === 'system') {
      return 'We\'re experiencing technical difficulties. Please try again in a few moments.';
    }

    // Default message
    return 'An unexpected error occurred. Please try again or contact support if the problem persists.';
  }

  /**
   * Handle error with comprehensive processing
   */
  static handleError(
    error: unknown,
    context: Partial<ErrorContext> = {}
  ): ErrorHandlingResult {
    const classification = this.classifyError(error);
    const userMessage = this.generateUserMessage(error, classification);
    
    const fullContext: ErrorContext = {
      operation: 'unknown',
      timestamp: new Date(),
      userAgent: navigator.userAgent,
      url: window.location.href,
      ...context
    };

    // Log the error
    this.logError(error, classification, fullContext);

    // Determine retry behavior
    const shouldRetry = classification.isRetryable && this.shouldRetryError(error);
    const retryDelay = shouldRetry ? this.calculateRetryDelay(error, 0) : undefined;

    return {
      handled: true,
      userMessage,
      shouldRetry,
      retryDelay,
      requiresReauth: classification.requiresReauth,
      logLevel: this.mapSeverityToLogLevel(classification.severity)
    };
  }

  /**
   * Execute operation with retry logic and error handling
   */
  static async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: Partial<ErrorContext> = {},
    config: Partial<RetryConfig> = {}
  ): Promise<T> {
    const retryConfig = { ...this.DEFAULT_RETRY_CONFIG, ...config };
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: unknown) {
        lastError = error;
        const classification = this.classifyError(error);

        // Don't retry if error is not retryable
        if (!classification.isRetryable || attempt === retryConfig.maxRetries) {
          break;
        }

        // Calculate delay for next attempt
        const delay = Math.min(
          retryConfig.baseDelay * Math.pow(retryConfig.backoffMultiplier, attempt),
          retryConfig.maxDelay
        );

        console.log(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`, errorFields(error).message);
        await this.sleep(delay);
      }
    }

    // All retries failed, handle the error
    const result = this.handleError(lastError, context);
    throw new Error(result.userMessage);
  }

  /**
   * Enhanced error logging with structured data
   */
  private static logError(
    error: unknown,
    classification: ErrorClassification,
    context: ErrorContext
  ): void {
    const { message, stack, code, name } = errorFields(error);
    const logData = {
      error: { message, stack, code, name },
      classification,
      context,
      timestamp: new Date().toISOString(),
      level: this.mapSeverityToLogLevel(classification.severity)
    };

    // Log to console with appropriate level
    switch (classification.severity) {
      case 'critical':
        console.error('CRITICAL ERROR:', logData);
        break;
      case 'high':
        console.error('HIGH SEVERITY ERROR:', logData);
        break;
      case 'medium':
        console.warn('MEDIUM SEVERITY ERROR:', logData);
        break;
      case 'low':
        console.info('LOW SEVERITY ERROR:', logData);
        break;
    }

    // In production, you would send this to your logging service
    // this.sendToLoggingService(logData);
  }

  /**
   * Utility methods for error classification
   */
  private static isAuthError(error: unknown): boolean {
    const { name, code } = errorFields(error);
    return error instanceof AuthError ||
           name === 'AuthError' ||
           (typeof code === 'string' && code.startsWith('auth_'));
  }

  private static isNetworkError(error: unknown): boolean {
    const { name, code, message } = errorFields(error);
    return name === 'NetworkError' ||
           code === 'NETWORK_ERROR' ||
           !!message?.includes('fetch') ||
           !!message?.includes('network');
  }

  private static getAuthErrorSeverity(message: string): ErrorClassification['severity'] {
    if (message.includes('session_not_found') || message.includes('expired')) return 'high';
    if (message.includes('invalid_credentials') || message.includes('unauthorized')) return 'medium';
    return 'low';
  }

  private static getSpotifyErrorSeverity(message: string, code: string | number): ErrorClassification['severity'] {
    if (message.includes('invalid_grant') || code === 401) return 'high';
    if (message.includes('rate_limit') || code === 429) return 'medium';
    return 'low';
  }

  private static isRetryableAuthError(message: string): boolean {
    const nonRetryableErrors = [
      'invalid_credentials',
      'user_not_found',
      'email_not_confirmed',
      'weak_password'
    ];
    return !nonRetryableErrors.some(error => message.includes(error));
  }

  private static isRetryableSpotifyError(message: string, code: string | number): boolean {
    if (code === 429 || message.includes('rate_limit')) return true;
    if (Number(code) >= 500) return true;
    if (message.includes('temporary') || message.includes('unavailable')) return true;
    return false;
  }

  private static requiresReauth(message: string): boolean {
    const reauthErrors = [
      'session_not_found',
      'invalid_grant',
      'unauthorized',
      'forbidden',
      'token_expired'
    ];
    return reauthErrors.some(error => message.includes(error));
  }

  /**
   * Error message generators
   */
  private static getAuthErrorMessage(message: string): string {
    const authMessages: Record<string, string> = {
      'invalid login credentials': 'Invalid email or password. Please check your credentials and try again.',
      'email not confirmed': 'Please check your email and click the confirmation link before signing in.',
      'user already registered': 'An account with this email already exists. Please sign in instead.',
      'password should be at least 6 characters': 'Password must be at least 6 characters long.',
      'unable to validate email address': 'Please enter a valid email address.',
      'signup_disabled': 'New account registration is currently disabled.',
      'email_address_not_authorized': 'This email address is not authorized to create an account.',
      'weak_password': 'Please choose a stronger password with at least 6 characters.',
      'session_not_found': 'Your session has expired. Please sign in again.',
      'invalid_request': 'Invalid request. Please try again.',
      'too_many_requests': 'Too many requests. Please wait a moment before trying again.',
    };

    for (const [key, value] of Object.entries(authMessages)) {
      if (message.includes(key)) return value;
    }

    return 'Authentication failed. Please try again or contact support.';
  }

  private static getNetworkErrorMessage(message: string): string {
    if (message.includes('timeout')) {
      return 'The request timed out. Please check your internet connection and try again.';
    }
    if (message.includes('offline') || message.includes('network')) {
      return 'You appear to be offline. Please check your internet connection.';
    }
    return 'Network error occurred. Please check your connection and try again.';
  }

  private static getSpotifyErrorMessage(message: string): string {
    if (message.includes('invalid_grant') || message.includes('refresh token')) {
      return 'Your Spotify connection has expired. Please reconnect your Spotify account.';
    }
    if (message.includes('rate_limit') || message.includes('too many requests')) {
      return 'Spotify rate limit reached. Please wait a moment before trying again.';
    }
    if (message.includes('unauthorized')) {
      return 'Spotify authorization failed. Please reconnect your account.';
    }
    return 'Spotify connection error. Please try again or reconnect your account.';
  }

  private static getValidationErrorMessage(message: string): string {
    if (message.includes('email')) {
      return 'Please enter a valid email address.';
    }
    if (message.includes('password')) {
      return 'Please check your password requirements.';
    }
    return 'Please check your input and try again.';
  }

  /**
   * Utility methods
   */
  private static shouldRetryError(error: unknown): boolean {
    const classification = this.classifyError(error);
    return classification.isRetryable;
  }

  private static calculateRetryDelay(error: unknown, attempt: number): number {
    const config = this.DEFAULT_RETRY_CONFIG;
    return Math.min(
      config.baseDelay * Math.pow(config.backoffMultiplier, attempt),
      config.maxDelay
    );
  }

  private static mapSeverityToLogLevel(severity: ErrorClassification['severity']): 'info' | 'warn' | 'error' | 'critical' {
    switch (severity) {
      case 'low': return 'info';
      case 'medium': return 'warn';
      case 'high': return 'error';
      case 'critical': return 'critical';
      default: return 'error';
    }
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default ErrorHandlingService;