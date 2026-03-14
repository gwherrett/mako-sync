/**
 * Tests for AuthRetryService
 *
 * Tests cover circuit breaker state management and the public API surface
 * that does not require live Supabase connections.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthRetryService } from '../authRetry.service';

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
