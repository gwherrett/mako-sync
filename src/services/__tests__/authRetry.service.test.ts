/**
 * Tests for AuthRetryService
 *
 * Tests cover circuit breaker state management and the public API surface
 * that does not require live Supabase connections.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuthRetryService } from '../authRetry.service';
import { AuthService } from '../auth.service';
import { SessionService } from '../session.service';
import { UserService } from '../user.service';
import { ErrorHandlingService } from '../errorHandling.service';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Reset circuit breaker state between tests */
function resetCircuitBreakers() {
  // Access private static map via bracket notation for test isolation
  (AuthRetryService as any).circuitBreakerStates = new Map();
  (AuthRetryService as any).resetCircuitBreaker('signUp');
  (AuthRetryService as any).resetCircuitBreaker('signIn');
  (AuthRetryService as any).resetCircuitBreaker('testOp');
}

// ─── getCircuitBreakerStatus ──────────────────────────────────────────────────

describe('AuthRetryService – getCircuitBreakerStatus()', () => {
  beforeEach(() => resetCircuitBreakers());

  it('returns an empty object when no operations have been attempted', () => {
    const status = AuthRetryService.getCircuitBreakerStatus();
    expect(Object.keys(status)).toHaveLength(0);
  });

  it('returns status for recorded operations', () => {
    const config = { ...(AuthRetryService as any).DEFAULT_CONFIG };
    (AuthRetryService as any).recordFailure('testOp', config);
    const status = AuthRetryService.getCircuitBreakerStatus();
    expect(status['testOp']).toBeDefined();
    expect(status['testOp'].failureCount).toBe(1);
  });

  it('returns a copy (not a reference to internal state)', () => {
    const config = { ...(AuthRetryService as any).DEFAULT_CONFIG };
    (AuthRetryService as any).recordFailure('testOp', config);
    const status = AuthRetryService.getCircuitBreakerStatus();
    status['testOp'].failureCount = 999;
    // Internal state should be unchanged
    const status2 = AuthRetryService.getCircuitBreakerStatus();
    expect(status2['testOp'].failureCount).toBe(1);
  });
});

// ─── Circuit breaker – recordFailure + isCircuitBreakerOpen ──────────────────

describe('AuthRetryService – circuit breaker state', () => {
  beforeEach(() => resetCircuitBreakers());

  it('circuit breaker is closed initially', () => {
    const config = { ...(AuthRetryService as any).DEFAULT_CONFIG };
    const isOpen = (AuthRetryService as any).isCircuitBreakerOpen('testOp', config);
    expect(isOpen).toBe(false);
  });

  it('circuit breaker opens after reaching threshold failures', () => {
    const config = {
      ...(AuthRetryService as any).DEFAULT_CONFIG,
      circuitBreakerThreshold: 3,
      circuitBreakerTimeout: 60000,
    };
    (AuthRetryService as any).recordFailure('testOp', config);
    (AuthRetryService as any).recordFailure('testOp', config);
    expect((AuthRetryService as any).isCircuitBreakerOpen('testOp', config)).toBe(false);
    (AuthRetryService as any).recordFailure('testOp', config); // 3rd failure hits threshold
    expect((AuthRetryService as any).isCircuitBreakerOpen('testOp', config)).toBe(true);
  });

  it('circuit breaker state includes nextAttemptTime when open', () => {
    const config = {
      ...(AuthRetryService as any).DEFAULT_CONFIG,
      circuitBreakerThreshold: 1,
      circuitBreakerTimeout: 60000,
    };
    (AuthRetryService as any).recordFailure('testOp', config);
    const state = AuthRetryService.getCircuitBreakerStatus()['testOp'];
    expect(state.isOpen).toBe(true);
    expect(state.nextAttemptTime).toBeInstanceOf(Date);
  });

  it('resetCircuitBreaker clears state', () => {
    const config = {
      ...(AuthRetryService as any).DEFAULT_CONFIG,
      circuitBreakerThreshold: 1,
    };
    (AuthRetryService as any).recordFailure('testOp', config);
    expect((AuthRetryService as any).isCircuitBreakerOpen('testOp', config)).toBe(true);
    (AuthRetryService as any).resetCircuitBreaker('testOp');
    expect((AuthRetryService as any).isCircuitBreakerOpen('testOp', config)).toBe(false);
    const status = AuthRetryService.getCircuitBreakerStatus();
    expect(status['testOp']?.failureCount).toBe(0);
  });

  it('circuit breaker resets automatically after timeout expires', () => {
    const config = {
      ...(AuthRetryService as any).DEFAULT_CONFIG,
      circuitBreakerThreshold: 1,
      circuitBreakerTimeout: 0, // immediate timeout
    };
    (AuthRetryService as any).recordFailure('testOp', config);
    // Wait 1ms then check — timeout is 0 so it should auto-reset
    const isOpen = (AuthRetryService as any).isCircuitBreakerOpen('testOp', config);
    // With 0ms timeout, nextAttemptTime is in the past — should be closed
    expect(isOpen).toBe(false);
  });

  it('failure count increments with each failure', () => {
    const config = { ...(AuthRetryService as any).DEFAULT_CONFIG, circuitBreakerThreshold: 10 };
    (AuthRetryService as any).recordFailure('testOp', config);
    (AuthRetryService as any).recordFailure('testOp', config);
    (AuthRetryService as any).recordFailure('testOp', config);
    const status = AuthRetryService.getCircuitBreakerStatus();
    expect(status['testOp'].failureCount).toBe(3);
  });

  it('independent operations have separate circuit breaker states', () => {
    const config = {
      ...(AuthRetryService as any).DEFAULT_CONFIG,
      circuitBreakerThreshold: 1,
    };
    (AuthRetryService as any).recordFailure('opA', config);
    expect((AuthRetryService as any).isCircuitBreakerOpen('opA', config)).toBe(true);
    expect((AuthRetryService as any).isCircuitBreakerOpen('opB', config)).toBe(false);
  });
});

// ─── healthCheck ─────────────────────────────────────────────────────────────

describe('AuthRetryService – healthCheck()', () => {
  beforeEach(() => resetCircuitBreakers());

  it('reports healthy when no circuit breakers are open', async () => {
    const result = await AuthRetryService.healthCheck();
    expect(result.healthy).toBe(true);
    expect(result.lastCheck).toBeInstanceOf(Date);
  });

  it('reports unhealthy when a circuit breaker is open', async () => {
    const config = {
      ...(AuthRetryService as any).DEFAULT_CONFIG,
      circuitBreakerThreshold: 1,
      circuitBreakerTimeout: 60000,
    };
    (AuthRetryService as any).recordFailure('signIn', config);
    const result = await AuthRetryService.healthCheck();
    expect(result.healthy).toBe(false);
  });

  it('includes circuit breaker states in health check result', async () => {
    const result = await AuthRetryService.healthCheck();
    expect(result.circuitBreakers).toBeDefined();
    expect(typeof result.circuitBreakers).toBe('object');
  });
});

// ─── DEFAULT_CONFIG ───────────────────────────────────────────────────────────

describe('AuthRetryService – DEFAULT_CONFIG', () => {
  it('has maxRetries of 3', () => {
    expect((AuthRetryService as any).DEFAULT_CONFIG.maxRetries).toBe(3);
  });

  it('has circuit breaker enabled by default', () => {
    expect((AuthRetryService as any).DEFAULT_CONFIG.enableCircuitBreaker).toBe(true);
  });

  it('has retryableErrors list including network_error', () => {
    expect((AuthRetryService as any).DEFAULT_CONFIG.retryableErrors).toContain('network_error');
  });

  it('has retryableErrors list including session_refresh_failed', () => {
    expect((AuthRetryService as any).DEFAULT_CONFIG.retryableErrors).toContain('session_refresh_failed');
  });

  it('has baseDelay of 1000ms', () => {
    expect((AuthRetryService as any).DEFAULT_CONFIG.baseDelay).toBe(1000);
  });

  it('has backoffMultiplier of 2', () => {
    expect((AuthRetryService as any).DEFAULT_CONFIG.backoffMultiplier).toBe(2);
  });
});

// ─── executeAuthOperation with mocked operation ───────────────────────────────

describe('AuthRetryService – executeAuthOperation() success path', () => {
  beforeEach(() => resetCircuitBreakers());

  it('returns success=true when operation succeeds on first attempt', async () => {
    const mockOp = vi.fn().mockResolvedValue({ session: { user: { id: '123' } } });
    const result = await (AuthRetryService as any).executeAuthOperation(
      mockOp,
      'testOp',
      {},
      { maxRetries: 2, enableCircuitBreaker: false }
    );
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
    expect(mockOp).toHaveBeenCalledTimes(1);
  });

  it('result includes data from operation on success', async () => {
    const mockData = { session: { token: 'abc' } };
    const mockOp = vi.fn().mockResolvedValue(mockData);
    const result = await (AuthRetryService as any).executeAuthOperation(
      mockOp,
      'testOp',
      {},
      { maxRetries: 0, enableCircuitBreaker: false }
    );
    expect(result.data).toEqual(mockData);
  });

  it('result includes totalTime', async () => {
    const mockOp = vi.fn().mockResolvedValue({});
    const result = await (AuthRetryService as any).executeAuthOperation(
      mockOp,
      'testOp',
      {},
      { maxRetries: 0, enableCircuitBreaker: false }
    );
    expect(typeof result.totalTime).toBe('number');
    expect(result.totalTime).toBeGreaterThanOrEqual(0);
  });
});

describe('AuthRetryService – executeAuthOperation() circuit breaker integration', () => {
  beforeEach(() => resetCircuitBreakers());

  it('returns failure immediately when circuit breaker is open', async () => {
    const config = {
      ...(AuthRetryService as any).DEFAULT_CONFIG,
      circuitBreakerThreshold: 1,
      circuitBreakerTimeout: 60000,
      enableCircuitBreaker: true,
    };
    // Manually open the circuit breaker
    (AuthRetryService as any).recordFailure('testOp', config);

    const mockOp = vi.fn().mockResolvedValue({});
    const result = await (AuthRetryService as any).executeAuthOperation(
      mockOp,
      'testOp',
      {},
      config
    );
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(0);
    expect(mockOp).not.toHaveBeenCalled();
  });
});

describe('AuthRetryService – executeAuthOperation() failure path', () => {
  const run = (op: () => Promise<unknown>, config: Record<string, unknown>) =>
    (AuthRetryService as any).executeAuthOperation(op, 'testOp', { operation: 'test' }, config);
  const shouldRetry = (value: boolean) =>
    vi.spyOn(ErrorHandlingService, 'handleError').mockReturnValue({ shouldRetry: value } as any);
  let sleep: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetCircuitBreakers();
    sleep = vi.spyOn(AuthRetryService as any, 'sleep').mockResolvedValue(undefined);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries a retryable error and succeeds on a later attempt', async () => {
    shouldRetry(true);
    const op = vi.fn()
      .mockRejectedValueOnce(new Error('network_error'))
      .mockResolvedValueOnce('ok');

    const result = await run(op, { maxRetries: 2, enableCircuitBreaker: false });

    expect(result).toMatchObject({ success: true, data: 'ok', attempts: 2 });
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('backs off within ±25% of the exponential delay, capped at maxDelay', async () => {
    shouldRetry(true);
    const op = vi.fn().mockRejectedValue(new Error('timeout'));

    await run(op, {
      maxRetries: 3,
      baseDelay: 1000,
      backoffMultiplier: 2,
      maxDelay: 1500,
      enableCircuitBreaker: false,
    });

    const delays = sleep.mock.calls.map(([ms]) => ms as number);
    expect(delays).toHaveLength(3);
    expect(delays[0]).toBeGreaterThanOrEqual(750);
    expect(delays[0]).toBeLessThanOrEqual(1250);
    // 2000 and 4000 are both capped to 1500.
    for (const delay of delays.slice(1)) {
      expect(delay).toBeGreaterThanOrEqual(1125);
      expect(delay).toBeLessThanOrEqual(1875);
    }
  });

  it('stops after maxRetries + 1 attempts and returns the last error', async () => {
    shouldRetry(true);
    const op = vi.fn().mockRejectedValue(new Error('still down'));

    const result = await run(op, { maxRetries: 2, enableCircuitBreaker: false });

    expect(op).toHaveBeenCalledTimes(3);
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3);
    expect(result.error.message).toBe('still down');
  });

  it('does not retry an error that is not retryable', async () => {
    shouldRetry(false);
    const op = vi.fn().mockRejectedValue(new Error('invalid_credentials'));

    const result = await run(op, { maxRetries: 3, enableCircuitBreaker: false });

    expect(op).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, attempts: 1 });
  });

  it('wraps a non-Error rejection in an Error', async () => {
    shouldRetry(false);

    const result = await run(() => Promise.reject('plain failure'), {
      maxRetries: 0,
      enableCircuitBreaker: false,
    });

    expect(result.error).toBeInstanceOf(Error);
    expect(result.error.message).toBe('plain failure');
  });

  it('passes the attempt number and maxRetries to the error handler', async () => {
    const handleError = shouldRetry(false);

    await run(() => Promise.reject(new Error('x')), { maxRetries: 4, enableCircuitBreaker: false });

    expect(handleError).toHaveBeenCalledWith(expect.any(Error), {
      operation: 'test',
      additionalData: { attempt: 1, maxRetries: 4 },
    });
  });

  it('records each failure on the circuit breaker and opens it at the threshold', async () => {
    shouldRetry(true);
    const op = vi.fn().mockRejectedValue(new Error('down'));

    await run(op, { maxRetries: 2, enableCircuitBreaker: true, circuitBreakerThreshold: 3 });

    const state = AuthRetryService.getCircuitBreakerStatus()['testOp'];
    expect(state.failureCount).toBe(3);
    expect(state.isOpen).toBe(true);
  });

  it('resets the circuit breaker after a success', async () => {
    shouldRetry(true);
    const op = vi.fn()
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValueOnce('ok');

    await run(op, { maxRetries: 1, enableCircuitBreaker: true, circuitBreakerThreshold: 5 });

    expect(AuthRetryService.getCircuitBreakerStatus()['testOp'].failureCount).toBe(0);
  });
});

describe('AuthRetryService – public operations', () => {
  const noBreaker = { enableCircuitBreaker: false, maxRetries: 0 };

  beforeEach(() => {
    resetCircuitBreakers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('signUpWithRetry calls AuthService.signUp', async () => {
    const data = { email: 'a@example.com', password: 'pw' } as any;
    const signUp = vi.spyOn(AuthService, 'signUp').mockResolvedValue('signed-up' as any);

    const result = await AuthRetryService.signUpWithRetry(data, noBreaker);

    expect(signUp).toHaveBeenCalledWith(data);
    expect(result.data).toBe('signed-up');
  });

  it('signInWithRetry calls AuthService.signIn', async () => {
    const data = { email: 'a@example.com', password: 'pw' } as any;
    const signIn = vi.spyOn(AuthService, 'signIn').mockResolvedValue('signed-in' as any);

    const result = await AuthRetryService.signInWithRetry(data, noBreaker);

    expect(signIn).toHaveBeenCalledWith(data);
    expect(result.data).toBe('signed-in');
  });

  it('refreshSessionWithRetry calls SessionService.refreshSession', async () => {
    const refresh = vi.spyOn(SessionService, 'refreshSession').mockResolvedValue('refreshed' as any);

    const result = await AuthRetryService.refreshSessionWithRetry(noBreaker);

    expect(refresh).toHaveBeenCalled();
    expect(result.data).toBe('refreshed');
  });

  it('resetPasswordWithRetry calls AuthService.resetPassword', async () => {
    const reset = vi.spyOn(AuthService, 'resetPassword').mockResolvedValue('sent' as any);

    const result = await AuthRetryService.resetPasswordWithRetry('a@example.com', noBreaker);

    expect(reset).toHaveBeenCalledWith('a@example.com');
    expect(result.data).toBe('sent');
  });

  it('updatePasswordWithRetry calls AuthService.updatePassword', async () => {
    const update = vi.spyOn(AuthService, 'updatePassword').mockResolvedValue('updated' as any);

    const result = await AuthRetryService.updatePasswordWithRetry('new-pw', noBreaker);

    expect(update).toHaveBeenCalledWith('new-pw');
    expect(result.data).toBe('updated');
  });

  it('updateProfileWithRetry calls UserService.updateProfile', async () => {
    const updates = { display_name: 'DJ' } as any;
    const update = vi.spyOn(UserService, 'updateProfile').mockResolvedValue('profile' as any);

    const result = await AuthRetryService.updateProfileWithRetry('user-1', updates, noBreaker);

    expect(update).toHaveBeenCalledWith('user-1', updates);
    expect(result.data).toBe('profile');
  });
});
