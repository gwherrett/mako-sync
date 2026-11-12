import { AuthError } from '@supabase/supabase-js';
import { AuthService, SignUpData, SignInData } from './auth.service';
import { SessionService } from './session.service';
import { UserService, type UpdateProfileData } from './user.service';
import { ErrorHandlingService, ErrorContext, RetryConfig } from './errorHandling.service';
import { getErrorMessage } from '@/utils/errorUtils';

export interface AuthRetryConfig extends RetryConfig {
  enableCircuitBreaker: boolean;
  circuitBreakerThreshold: number;
  circuitBreakerTimeout: number;
}

/** The result of retrying `Fn`, carrying the value `Fn` resolves to. */
type RetryResultOf<Fn extends (...args: never[]) => Promise<unknown>> = AuthOperationResult<Awaited<ReturnType<Fn>>>;

export interface AuthOperationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: AuthError | Error;
  attempts: number;
  totalTime: number;
}

export interface CircuitBreakerState {
  isOpen: boolean;
  failureCount: number;
  lastFailureTime: Date | null;
  nextAttemptTime: Date | null;
}

export class AuthRetryService {
  private static readonly DEFAULT_CONFIG: AuthRetryConfig = {
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
      'too_many_requests',
      'session_refresh_failed'
    ],
    enableCircuitBreaker: true,
    circuitBreakerThreshold: 5,
    circuitBreakerTimeout: 60000 // 1 minute
  };

  private static circuitBreakerStates: Map<string, CircuitBreakerState> = new Map();

  /**
   * Enhanced sign up with retry logic
   */
  static async signUpWithRetry(
    data: SignUpData,
    config: Partial<AuthRetryConfig> = {}
  ): Promise<RetryResultOf<typeof AuthService.signUp>> {
    const context: Partial<ErrorContext> = {
      operation: 'signUp',
      component: 'AuthRetryService',
      additionalData: { email: data.email }
    };

    return this.executeAuthOperation(
      () => AuthService.signUp(data),
      'signUp',
      context,
      config
    );
  }

  /**
   * Enhanced sign in with retry logic
   */
  static async signInWithRetry(
    data: SignInData,
    config: Partial<AuthRetryConfig> = {}
  ): Promise<RetryResultOf<typeof AuthService.signIn>> {
    const context: Partial<ErrorContext> = {
      operation: 'signIn',
      component: 'AuthRetryService',
      additionalData: { email: data.email }
    };

    return this.executeAuthOperation(
      () => AuthService.signIn(data),
      'signIn',
      context,
      config
    );
  }

  /**
   * Enhanced session refresh with retry logic
   */
  static async refreshSessionWithRetry(
    config: Partial<AuthRetryConfig> = {}
  ): Promise<RetryResultOf<typeof SessionService.refreshSession>> {
    const context: Partial<ErrorContext> = {
      operation: 'refreshSession',
      component: 'AuthRetryService'
    };

    return this.executeAuthOperation(
      () => SessionService.refreshSession(),
      'refreshSession',
      context,
      config
    );
  }

  /**
   * Enhanced password reset with retry logic
   */
  static async resetPasswordWithRetry(
    email: string,
    config: Partial<AuthRetryConfig> = {}
  ): Promise<RetryResultOf<typeof AuthService.resetPassword>> {
    const context: Partial<ErrorContext> = {
      operation: 'resetPassword',
      component: 'AuthRetryService',
      additionalData: { email }
    };

    return this.executeAuthOperation(
      () => AuthService.resetPassword(email),
      'resetPassword',
      context,
      config
    );
  }

  /**
   * Enhanced password update with retry logic
   */
  static async updatePasswordWithRetry(
    password: string,
    config: Partial<AuthRetryConfig> = {}
  ): Promise<RetryResultOf<typeof AuthService.updatePassword>> {
    const context: Partial<ErrorContext> = {
      operation: 'updatePassword',
      component: 'AuthRetryService'
    };

    return this.executeAuthOperation(
      () => AuthService.updatePassword(password),
      'updatePassword',
      context,
      config
    );
  }

  /**
   * Enhanced profile update with retry logic
   */
  static async updateProfileWithRetry(
    userId: string,
    updates: UpdateProfileData,
    config: Partial<AuthRetryConfig> = {}
  ): Promise<RetryResultOf<typeof UserService.updateProfile>> {
    const context: Partial<ErrorContext> = {
      operation: 'updateProfile',
      component: 'AuthRetryService',
      userId,
      additionalData: { updates }
    };

    return this.executeAuthOperation(
      () => UserService.updateProfile(userId, updates),
      'updateProfile',
      context,
      config
    );
  }

  /**
   * Core retry execution logic with circuit breaker
   */
  private static async executeAuthOperation<T>(
    operation: () => Promise<T>,
    operationType: string,
    context: Partial<ErrorContext>,
    config: Partial<AuthRetryConfig>
  ): Promise<AuthOperationResult<T>> {
    const retryConfig = { ...this.DEFAULT_CONFIG, ...config };
    const startTime = Date.now();
    let attempts: number;
    let lastError: Error | AuthError | null = null;

    // Check circuit breaker
    if (retryConfig.enableCircuitBreaker && this.isCircuitBreakerOpen(operationType, retryConfig)) {
      const circuitState = this.circuitBreakerStates.get(operationType);
      return {
        success: false,
        error: new Error(`Circuit breaker is open for ${operationType}. Next attempt allowed at ${circuitState?.nextAttemptTime?.toISOString()}`),
        attempts: 0,
        totalTime: Date.now() - startTime
      };
    }

    for (attempts = 1; attempts <= retryConfig.maxRetries + 1; attempts++) {
      try {
        console.log(`Auth operation ${operationType} - Attempt ${attempts}/${retryConfig.maxRetries + 1}`);
        
        const result = await operation();
        
        // Success - reset circuit breaker
        if (retryConfig.enableCircuitBreaker) {
          this.resetCircuitBreaker(operationType);
        }

        return {
          success: true,
          data: result,
          attempts,
          totalTime: Date.now() - startTime
        };

      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(getErrorMessage(error));
        console.error(`Auth operation ${operationType} attempt ${attempts} failed:`, lastError.message);

        // Handle the error through our error handling service
        const errorResult = ErrorHandlingService.handleError(error, {
          ...context,
          additionalData: {
            ...context.additionalData,
            attempt: attempts,
            maxRetries: retryConfig.maxRetries
          }
        });

        // Update circuit breaker on failure
        if (retryConfig.enableCircuitBreaker) {
          this.recordFailure(operationType, retryConfig);
        }

        // Don't retry if it's the last attempt or error is not retryable
        if (attempts > retryConfig.maxRetries || !errorResult.shouldRetry) {
          break;
        }

        // Calculate delay with jitter
        const baseDelay = Math.min(
          retryConfig.baseDelay * Math.pow(retryConfig.backoffMultiplier, attempts - 1),
          retryConfig.maxDelay
        );
        
        // Add jitter (±25% of base delay)
        const jitter = baseDelay * 0.25 * (Math.random() * 2 - 1);
        const delay = Math.max(100, baseDelay + jitter);

        console.log(`Retrying ${operationType} in ${Math.round(delay)}ms...`);
        await this.sleep(delay);
      }
    }

    // All attempts failed. Every failure leaves the loop through `break`, which skips the
    // increment, so `attempts` is already the number of attempts made.
    return {
      success: false,
      error: lastError || new Error(`${operationType} failed after ${attempts} attempts`),
      attempts,
      totalTime: Date.now() - startTime
    };
  }

  /**
   * Circuit breaker implementation
   */
  private static isCircuitBreakerOpen(operationType: string, config: AuthRetryConfig): boolean {
    const state = this.circuitBreakerStates.get(operationType);
    
    if (!state) return false;
    
    // Check if circuit breaker should be closed (timeout expired)
    if (state.isOpen && state.nextAttemptTime && new Date() >= state.nextAttemptTime) {
      state.isOpen = false;
      state.failureCount = 0;
      state.nextAttemptTime = null;
      return false;
    }
    
    return state.isOpen;
  }

  private static recordFailure(operationType: string, config: AuthRetryConfig): void {
    let state = this.circuitBreakerStates.get(operationType);
    
    if (!state) {
      state = {
        isOpen: false,
        failureCount: 0,
        lastFailureTime: null,
        nextAttemptTime: null
      };
      this.circuitBreakerStates.set(operationType, state);
    }
    
    state.failureCount++;
    state.lastFailureTime = new Date();
    
    // Open circuit breaker if threshold is reached
    if (state.failureCount >= config.circuitBreakerThreshold) {
      state.isOpen = true;
      state.nextAttemptTime = new Date(Date.now() + config.circuitBreakerTimeout);
      console.warn(`Circuit breaker opened for ${operationType}. Next attempt allowed at ${state.nextAttemptTime.toISOString()}`);
    }
  }

  private static resetCircuitBreaker(operationType: string): void {
    const state = this.circuitBreakerStates.get(operationType);
    if (state) {
      state.isOpen = false;
      state.failureCount = 0;
      state.lastFailureTime = null;
      state.nextAttemptTime = null;
    }
  }

  /**
   * Get circuit breaker status for monitoring
   */
  static getCircuitBreakerStatus(): Record<string, CircuitBreakerState> {
    const status: Record<string, CircuitBreakerState> = {};
    
    for (const [operationType, state] of this.circuitBreakerStates.entries()) {
      status[operationType] = { ...state };
    }
    
    return status;
  }


  /**
   * Health check for auth operations
   */
  static async healthCheck(): Promise<{
    healthy: boolean;
    circuitBreakers: Record<string, CircuitBreakerState>;
    lastCheck: Date;
  }> {
    const circuitBreakers = this.getCircuitBreakerStatus();
    const hasOpenCircuits = Object.values(circuitBreakers).some(state => state.isOpen);
    
    return {
      healthy: !hasOpenCircuits,
      circuitBreakers,
      lastCheck: new Date()
    };
  }

  /**
   * Utility method for sleep
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default AuthRetryService;