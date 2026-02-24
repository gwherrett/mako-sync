import { describe, it, expect, vi, beforeEach } from 'vitest';
import StartupSessionValidatorService from '../startupSessionValidator.service';

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Use vi.hoisted so these are available inside the vi.mock factory (which is hoisted)
const { mockGetSession, mockGetUser, mockSignOut } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetUser: vi.fn(),
  mockSignOut: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
      getUser: mockGetUser,
      signOut: mockSignOut,
    },
  },
}));

vi.mock('@/utils/promiseUtils', () => ({
  withTimeout: vi.fn(async (promise: Promise<any>, _timeout: number, _label: string) => {
    return await promise;
  }),
}));

// ─── localStorage / sessionStorage stub for node environment ─────────────────
// vitest runs in 'node' environment where localStorage doesn't exist.
// We stub it globally so the validator's hasCachedAuthTokens() and
// clearStaleTokens() behave realistically.

class StorageStub {
  private store: Record<string, string> = {};

  setItem(key: string, value: string) { this.store[key] = value; }
  getItem(key: string) { return this.store[key] ?? null; }
  removeItem(key: string) { delete this.store[key]; }
  clear() { this.store = {}; }
  key(i: number) { return Object.keys(this.store)[i] ?? null; }
  get length() { return Object.keys(this.store).length; }

  // Object.keys() support
  [Symbol.iterator]() { return Object.keys(this.store)[Symbol.iterator](); }
}

// Attach stubs to global before tests run
const localStorageStub = new StorageStub();
const sessionStorageStub = new StorageStub();
Object.defineProperty(global, 'localStorage', { value: localStorageStub, writable: true });
Object.defineProperty(global, 'sessionStorage', { value: sessionStorageStub, writable: true });

// Make Object.keys(localStorage) work (the validator iterates keys this way)
// StorageStub's store is a plain object so we override Object.keys to look through the stub
const _originalObjectKeys = Object.keys.bind(Object);
vi.spyOn(Object, 'keys').mockImplementation((obj: any) => {
  if (obj === localStorageStub) return _originalObjectKeys(localStorageStub['store']);
  if (obj === sessionStorageStub) return _originalObjectKeys(sessionStorageStub['store']);
  return _originalObjectKeys(obj);
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const futureExpiry = () => Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
const pastExpiry = () => Math.floor(Date.now() / 1000) - 3600;  // 1 hour ago

function makeSession(expiresAt = futureExpiry()) {
  return {
    data: { session: { expires_at: expiresAt, access_token: 'tok' } },
    error: null,
  };
}

function makeUser(id = 'user-123') {
  return { data: { user: { id, email: 'test@example.com' } }, error: null };
}

// Seed localStorage with a fake supabase auth token key
function seedLocalStorage() {
  localStorageStub.setItem('sb-test-auth-token', 'fake-token-value');
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('StartupSessionValidatorService', () => {
  let validator: StartupSessionValidatorService;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageStub.clear();
    sessionStorageStub.clear();
    mockSignOut.mockResolvedValue({ error: null });

    // Create a fresh instance for every test (bypass singleton for isolation)
    validator = new (StartupSessionValidatorService as any)();
  });

  // ── Singleton ──────────────────────────────────────────────────────────────

  describe('getInstance', () => {
    it('returns the same instance on repeated calls', () => {
      const a = StartupSessionValidatorService.getInstance();
      const b = StartupSessionValidatorService.getInstance();
      expect(a).toBe(b);
    });
  });

  // ── isValidationComplete ───────────────────────────────────────────────────

  describe('isValidationComplete', () => {
    it('returns false before any validation', () => {
      expect(validator.isValidationComplete()).toBe(false);
    });

    it('returns true after markAsValidated', () => {
      validator.markAsValidated();
      expect(validator.isValidationComplete()).toBe(true);
    });

    it('returns true after successful validation', async () => {
      seedLocalStorage();
      mockGetSession.mockResolvedValue(makeSession());
      mockGetUser.mockResolvedValue(makeUser());

      await validator.validateOnStartup();
      expect(validator.isValidationComplete()).toBe(true);
    });
  });

  // ── isExternallyValidated ──────────────────────────────────────────────────

  describe('isExternallyValidated', () => {
    it('returns false initially', () => {
      expect(validator.isExternallyValidated()).toBe(false);
    });

    it('returns true after markAsValidated', () => {
      validator.markAsValidated();
      expect(validator.isExternallyValidated()).toBe(true);
    });
  });

  // ── reset ──────────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('clears all validation state', () => {
      validator.markAsValidated();
      expect(validator.isValidationComplete()).toBe(true);

      validator.reset();
      expect(validator.isValidationComplete()).toBe(false);
      expect(validator.isExternallyValidated()).toBe(false);
    });
  });

  // ── No cached tokens ───────────────────────────────────────────────────────

  describe('validateOnStartup – no cached tokens', () => {
    it('returns isValid=true without calling supabase when localStorage is empty', async () => {
      // localStorage is already empty from beforeEach
      const result = await validator.validateOnStartup();

      expect(result.isValid).toBe(true);
      expect(result.wasCleared).toBe(false);
      expect(result.reason).toBe('No cached tokens');
      expect(mockGetSession).not.toHaveBeenCalled();
    });
  });

  // ── Already validated ──────────────────────────────────────────────────────

  describe('validateOnStartup – already validated', () => {
    it('returns immediately without hitting supabase when already complete', async () => {
      seedLocalStorage();
      mockGetSession.mockResolvedValue(makeSession());
      mockGetUser.mockResolvedValue(makeUser());
      await validator.validateOnStartup(); // first call completes validation

      mockGetSession.mockClear();
      mockGetUser.mockClear();

      const result = await validator.validateOnStartup(); // second call
      expect(result.isValid).toBe(true);
      expect(result.reason).toBe('Already validated');
      expect(mockGetSession).not.toHaveBeenCalled();
    });
  });

  // ── Valid session ──────────────────────────────────────────────────────────

  describe('validateOnStartup – valid session', () => {
    it('returns isValid=true when session and user are valid', async () => {
      seedLocalStorage();
      mockGetSession.mockResolvedValue(makeSession());
      mockGetUser.mockResolvedValue(makeUser());

      const result = await validator.validateOnStartup();

      expect(result.isValid).toBe(true);
      expect(result.wasCleared).toBe(false);
      expect(result.reason).toBe('Valid session');
    });

    it('calls getSession then getUser in sequence', async () => {
      seedLocalStorage();
      mockGetSession.mockResolvedValue(makeSession());
      mockGetUser.mockResolvedValue(makeUser());

      await validator.validateOnStartup();

      expect(mockGetSession).toHaveBeenCalledOnce();
      expect(mockGetUser).toHaveBeenCalledOnce();
    });
  });

  // ── Expired session ────────────────────────────────────────────────────────

  describe('validateOnStartup – expired session', () => {
    it('clears tokens and returns isValid=false for an expired session', async () => {
      seedLocalStorage();
      mockGetSession.mockResolvedValue(makeSession(pastExpiry()));

      const result = await validator.validateOnStartup();

      expect(result.isValid).toBe(false);
      expect(result.wasCleared).toBe(true);
      expect(result.reason).toBe('Session expired');
      // localStorage should have been cleared
      expect(localStorageStub.getItem('sb-test-auth-token')).toBeNull();
      expect(mockSignOut).toHaveBeenCalled();
    });

    it('does not call getUser for an expired session', async () => {
      seedLocalStorage();
      mockGetSession.mockResolvedValue(makeSession(pastExpiry()));

      await validator.validateOnStartup();

      expect(mockGetUser).not.toHaveBeenCalled();
    });
  });

  // ── No session in cache ────────────────────────────────────────────────────

  describe('validateOnStartup – no session returned', () => {
    it('clears tokens and returns isValid=false when session is null', async () => {
      seedLocalStorage();
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

      const result = await validator.validateOnStartup();

      expect(result.isValid).toBe(false);
      expect(result.wasCleared).toBe(true);
      expect(result.reason).toBe('No valid session');
    });
  });

  // ── Server rejects token ───────────────────────────────────────────────────

  describe('validateOnStartup – server rejects token', () => {
    it('clears tokens and returns isValid=false when getUser returns an error', async () => {
      seedLocalStorage();
      mockGetSession.mockResolvedValue(makeSession());
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'JWT expired', name: 'AuthApiError' },
      });

      const result = await validator.validateOnStartup();

      expect(result.isValid).toBe(false);
      expect(result.wasCleared).toBe(true);
      expect(result.reason).toBe('Server rejected token');
      expect(localStorageStub.getItem('sb-test-auth-token')).toBeNull();
    });

    it('clears tokens and returns isValid=false when getUser returns no user', async () => {
      seedLocalStorage();
      mockGetSession.mockResolvedValue(makeSession());
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const result = await validator.validateOnStartup();

      expect(result.isValid).toBe(false);
      expect(result.wasCleared).toBe(true);
      expect(result.reason).toBe('No user returned');
    });
  });

  // ── Network errors ─────────────────────────────────────────────────────────

  describe('validateOnStartup – network errors', () => {
    it('preserves session on network error from getUser', async () => {
      seedLocalStorage();
      mockGetSession.mockResolvedValue(makeSession());
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Failed to fetch', name: 'TypeError' },
      });

      const result = await validator.validateOnStartup();

      expect(result.isValid).toBe(true);
      expect(result.wasCleared).toBe(false);
      expect(result.reason).toBe('Network error - session preserved');
      // Tokens must NOT have been cleared
      expect(localStorageStub.getItem('sb-test-auth-token')).not.toBeNull();
    });

    it('preserves session on connection error from getUser', async () => {
      seedLocalStorage();
      mockGetSession.mockResolvedValue(makeSession());
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'network error occurred', name: 'NetworkError' },
      });

      const result = await validator.validateOnStartup();

      expect(result.isValid).toBe(true);
      expect(result.wasCleared).toBe(false);
    });
  });

  // ── clearStaleTokens skips when externally validated ──────────────────────

  describe('clearStaleTokens – external validation guard', () => {
    it('does not clear tokens when externally validated before an expired session check', async () => {
      seedLocalStorage();
      // Mark as externally validated (simulates TOKEN_REFRESHED event arriving first)
      validator.markAsValidated();

      // Even with an expired session, tokens should not be wiped
      mockGetSession.mockResolvedValue(makeSession(pastExpiry()));

      // validateOnStartup returns immediately because validationComplete=true
      const result = await validator.validateOnStartup();

      expect(result.isValid).toBe(true);
      expect(result.reason).toBe('Already validated');
      // Tokens should still be present
      expect(localStorageStub.getItem('sb-test-auth-token')).not.toBeNull();
    });
  });

  // ── Deduplication ─────────────────────────────────────────────────────────

  describe('validateOnStartup – concurrent call deduplication', () => {
    it('returns the same promise when called concurrently', async () => {
      seedLocalStorage();
      // Make getSession slow so both calls are in-flight simultaneously
      mockGetSession.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(makeSession()), 10))
      );
      mockGetUser.mockResolvedValue(makeUser());

      const [result1, result2] = await Promise.all([
        validator.validateOnStartup(),
        validator.validateOnStartup(),
      ]);

      // Both should return the same valid result
      expect(result1.isValid).toBe(true);
      expect(result2.isValid).toBe(true);
      // getSession should only have been called once despite two concurrent callers
      expect(mockGetSession).toHaveBeenCalledOnce();
    });
  });

  // ── hasCachedAuthTokens key patterns ─────────────────────────────────────

  describe('hasCachedAuthTokens – key detection', () => {
    it('detects sb- prefixed keys', async () => {
      localStorage.setItem('sb-project-auth-token', 'value');
      mockGetSession.mockResolvedValue(makeSession());
      mockGetUser.mockResolvedValue(makeUser());

      const result = await validator.validateOnStartup();
      expect(mockGetSession).toHaveBeenCalled(); // validator found tokens and proceeded
      expect(result.isValid).toBe(true);
    });

    it('detects supabase keys', async () => {
      localStorage.setItem('supabase.auth.token', 'value');
      mockGetSession.mockResolvedValue(makeSession());
      mockGetUser.mockResolvedValue(makeUser());

      const result = await validator.validateOnStartup();
      expect(mockGetSession).toHaveBeenCalled();
      expect(result.isValid).toBe(true);
    });

    it('detects auth-token keys', async () => {
      localStorage.setItem('my-app-auth-token', 'value');
      mockGetSession.mockResolvedValue(makeSession());
      mockGetUser.mockResolvedValue(makeUser());

      const result = await validator.validateOnStartup();
      expect(mockGetSession).toHaveBeenCalled();
      expect(result.isValid).toBe(true);
    });

    it('skips validation when no matching keys exist', async () => {
      localStorage.setItem('theme', 'dark');
      localStorage.setItem('lang', 'en');

      const result = await validator.validateOnStartup();
      expect(mockGetSession).not.toHaveBeenCalled();
      expect(result.reason).toBe('No cached tokens');
    });
  });
});
