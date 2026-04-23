import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthStateRecoveryService } from '../authStateRecovery.service';
import { supabase } from '@/integrations/supabase/client';
import { UserService } from '../user.service';
import { SessionService } from '../session.service';
import { AuthRetryService } from '../authRetry.service';

vi.mock('../user.service', () => ({
  UserService: {
    getUserProfile: vi.fn(),
    getUserRole: vi.fn(),
  },
}));

vi.mock('../session.service', () => ({
  SessionService: {
    validateSession: vi.fn(),
  },
}));

vi.mock('../authRetry.service', () => ({
  AuthRetryService: {
    refreshSessionWithRetry: vi.fn(),
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FUTURE_EXPIRES = Math.floor(Date.now() / 1000) + 3600;

const mockUser = { id: 'user-1', email: 'test@example.com' } as any;
const mockSession = {
  access_token: 'tok',
  refresh_token: 'ref',
  expires_at: FUTURE_EXPIRES,
  user: mockUser,
} as any;

function resetStaticState() {
  AuthStateRecoveryService.resetRecoveryState();
}

// ─── createStateSnapshot ──────────────────────────────────────────────────────

describe('AuthStateRecoveryService – createStateSnapshot()', () => {
  beforeEach(() => {
    resetStaticState();
    vi.mocked(UserService.getUserProfile).mockResolvedValue({ profile: null, error: null } as any);
    vi.mocked(UserService.getUserRole).mockResolvedValue({ role: 'user', error: null } as any);
  });

  it('returns a valid snapshot when session and user are present', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
      data: { session: mockSession },
      error: null,
    });
    vi.mocked(supabase.auth.getUser).mockResolvedValueOnce({
      data: { user: mockUser },
      error: null,
    });

    const snap = await AuthStateRecoveryService.createStateSnapshot();

    expect(snap.user).toEqual(mockUser);
    expect(snap.session).toEqual(mockSession);
    expect(snap.timestamp).toBeInstanceOf(Date);
    expect(snap.isValid).toBe(true);
  });

  it('returns an invalid snapshot when there is no session', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
      data: { session: null },
      error: null,
    });
    vi.mocked(supabase.auth.getUser).mockResolvedValueOnce({
      data: { user: null },
      error: null,
    });

    const snap = await AuthStateRecoveryService.createStateSnapshot();

    expect(snap.user).toBeNull();
    expect(snap.session).toBeNull();
    expect(snap.isValid).toBe(true); // no user + no session → valid (guest)
  });

  it('fetches profile and role when user is present', async () => {
    const profile = { id: 'user-1', display_name: 'Test' } as any;
    vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
      data: { session: mockSession },
      error: null,
    });
    vi.mocked(supabase.auth.getUser).mockResolvedValueOnce({
      data: { user: mockUser },
      error: null,
    });
    vi.mocked(UserService.getUserProfile).mockResolvedValueOnce({ profile, error: null } as any);
    vi.mocked(UserService.getUserRole).mockResolvedValueOnce({ role: 'admin', error: null } as any);

    const snap = await AuthStateRecoveryService.createStateSnapshot();

    expect(snap.profile).toEqual(profile);
    expect(snap.role).toBe('admin');
  });

  it('returns a fallback snapshot on unexpected error', async () => {
    vi.mocked(supabase.auth.getSession).mockRejectedValueOnce(new Error('network'));

    const snap = await AuthStateRecoveryService.createStateSnapshot();

    expect(snap.user).toBeNull();
    expect(snap.session).toBeNull();
    expect(snap.isValid).toBe(false);
  });

  it('marks snapshot invalid when user exists but session is null', async () => {
    // session=null, user=mockUser → validateStateSnapshot returns false
    vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
      data: { session: null },
      error: null,
    });
    vi.mocked(supabase.auth.getUser).mockResolvedValueOnce({
      data: { user: mockUser },
      error: null,
    });

    const snap = await AuthStateRecoveryService.createStateSnapshot();

    expect(snap.isValid).toBe(false);
  });

  it('marks snapshot invalid when session is expired', async () => {
    const expiredSession = { ...mockSession, expires_at: Math.floor(Date.now() / 1000) - 60 };
    vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
      data: { session: expiredSession },
      error: null,
    });
    vi.mocked(supabase.auth.getUser).mockResolvedValueOnce({
      data: { user: mockUser },
      error: null,
    });

    const snap = await AuthStateRecoveryService.createStateSnapshot();

    expect(snap.isValid).toBe(false);
  });
});

// ─── backupAuthState ──────────────────────────────────────────────────────────

describe('AuthStateRecoveryService – backupAuthState()', () => {
  beforeEach(() => {
    resetStaticState();
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: null,
    });
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: null },
      error: null,
    });
    vi.mocked(UserService.getUserProfile).mockResolvedValue({ profile: null, error: null } as any);
    vi.mocked(UserService.getUserRole).mockResolvedValue({ role: null, error: null } as any);
  });

  it('writes backup to localStorage', async () => {
    await AuthStateRecoveryService.backupAuthState('automatic');

    expect(localStorage.setItem).toHaveBeenCalledWith(
      'mako_auth_backup',
      expect.stringContaining('"source":"automatic"')
    );
  });

  it('stores manual source correctly', async () => {
    await AuthStateRecoveryService.backupAuthState('manual');

    expect(localStorage.setItem).toHaveBeenCalledWith(
      'mako_auth_backup',
      expect.stringContaining('"source":"manual"')
    );
  });

  it('does not throw when snapshot creation fails', async () => {
    vi.mocked(supabase.auth.getSession).mockRejectedValueOnce(new Error('fail'));

    await expect(AuthStateRecoveryService.backupAuthState()).resolves.toBeUndefined();
  });
});

// ─── recoverAuthState ─────────────────────────────────────────────────────────

describe('AuthStateRecoveryService – recoverAuthState()', () => {
  beforeEach(() => {
    resetStaticState();
    vi.mocked(UserService.getUserProfile).mockResolvedValue({ profile: null, error: null } as any);
    vi.mocked(UserService.getUserRole).mockResolvedValue({ role: 'user', error: null } as any);
  });

  it('returns error when recovery is already in progress', async () => {
    // Trigger a long-running recovery by not resolving the mock
    vi.mocked(AuthRetryService.refreshSessionWithRetry).mockReturnValue(new Promise(() => {}));
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null }, error: null });
    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: null }, error: null });

    // Start first recovery (don't await)
    const first = AuthStateRecoveryService.recoverAuthState();

    // Second attempt while first is still running
    const second = await AuthStateRecoveryService.recoverAuthState();

    expect(second.success).toBe(false);
    expect(second.error?.message).toMatch(/already in progress/i);

    // Clean up
    first.catch(() => {});
    resetStaticState();
  });

  it('uses fallback when max recovery attempts exceeded', async () => {
    // Exhaust attempts by calling recoverAuthState until max
    vi.mocked(AuthRetryService.refreshSessionWithRetry).mockResolvedValue({
      success: false,
      data: null,
      error: new Error('fail'),
    } as any);
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null }, error: null });
    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: null }, error: null });
    vi.mocked(SessionService.validateSession).mockResolvedValue({ isValid: false } as any);

    // Run until max attempts (default 3)
    await AuthStateRecoveryService.recoverAuthState();
    await AuthStateRecoveryService.recoverAuthState();
    const result = await AuthStateRecoveryService.recoverAuthState();
    const maxed = await AuthStateRecoveryService.recoverAuthState();

    expect(maxed.fallbackUsed).toBe(true);
    expect(maxed.success).toBe(true); // fallback is considered success
  });

  it('succeeds via session refresh when session is valid', async () => {
    vi.mocked(AuthRetryService.refreshSessionWithRetry).mockResolvedValueOnce({
      success: true,
      data: { session: mockSession },
      error: null,
    } as any);
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: mockSession },
      error: null,
    });
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: mockUser },
      error: null,
    });

    const result = await AuthStateRecoveryService.recoverAuthState();

    expect(result.success).toBe(true);
    expect(result.recovered).toBe(true);
    expect(result.recoveryMethod).toBe('session_refresh');
  });

  it('succeeds via token recovery when session exists but refresh fails', async () => {
    // Session refresh fails
    vi.mocked(AuthRetryService.refreshSessionWithRetry).mockResolvedValue({
      success: false,
      data: null,
      error: new Error('refresh failed'),
    } as any);
    // getSession returns a valid session for token recovery path
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: mockSession },
      error: null,
    });
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: mockUser },
      error: null,
    });
    vi.mocked(SessionService.validateSession).mockResolvedValue({ isValid: true } as any);

    const result = await AuthStateRecoveryService.recoverAuthState();

    expect(result.success).toBe(true);
    expect(result.recoveryMethod).toBe('token_recovery');
  });

  it('falls back to guest when all methods fail and fallbackToGuest=true', async () => {
    vi.mocked(AuthRetryService.refreshSessionWithRetry).mockResolvedValue({
      success: false,
      data: null,
      error: new Error('fail'),
    } as any);
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null }, error: null });
    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: null }, error: null });
    vi.mocked(SessionService.validateSession).mockResolvedValue({ isValid: false } as any);

    const result = await AuthStateRecoveryService.recoverAuthState({ fallbackToGuest: true });

    expect(result.fallbackUsed).toBe(true);
    expect(result.newState?.user).toBeNull();
    expect(result.newState?.isValid).toBe(true);
  });

  it('returns failure when fallbackToGuest=false and all methods fail', async () => {
    vi.mocked(AuthRetryService.refreshSessionWithRetry).mockResolvedValue({
      success: false,
      data: null,
      error: new Error('fail'),
    } as any);
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null }, error: null });
    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: null }, error: null });
    vi.mocked(SessionService.validateSession).mockResolvedValue({ isValid: false } as any);

    const result = await AuthStateRecoveryService.recoverAuthState({ fallbackToGuest: false });

    expect(result.success).toBe(false);
    expect(result.fallbackUsed).toBe(false);
  });

  it('tries localStorage backup when both session and token recovery fail', async () => {
    vi.mocked(AuthRetryService.refreshSessionWithRetry).mockResolvedValue({
      success: false,
      data: null,
      error: new Error('fail'),
    } as any);
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null }, error: null });
    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: null }, error: null });
    vi.mocked(SessionService.validateSession).mockResolvedValue({ isValid: false } as any);

    // Put a valid backup in localStorage
    const backup = {
      snapshot: {
        user: mockUser,
        session: mockSession,
        profile: null,
        role: 'user',
        timestamp: new Date().toISOString(),
        isValid: true,
      },
      backupTime: new Date().toISOString(),
      source: 'automatic',
    };
    vi.mocked(localStorage.getItem).mockReturnValueOnce(null); // no backup check in first call
    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(backup));

    // localStorage recovery still returns success:false (not implemented), so falls back
    const result = await AuthStateRecoveryService.recoverAuthState({ fallbackToGuest: true });

    expect(result.fallbackUsed).toBe(true);
  });
});

// ─── isRecoveryNeeded ─────────────────────────────────────────────────────────

describe('AuthStateRecoveryService – isRecoveryNeeded()', () => {
  beforeEach(() => {
    resetStaticState();
    vi.mocked(UserService.getUserProfile).mockResolvedValue({ profile: null, error: null } as any);
    vi.mocked(UserService.getUserRole).mockResolvedValue({ role: null, error: null } as any);
  });

  it('returns false when current state is valid', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
      data: { session: null },
      error: null,
    });
    vi.mocked(supabase.auth.getUser).mockResolvedValueOnce({
      data: { user: null },
      error: null,
    });

    const needed = await AuthStateRecoveryService.isRecoveryNeeded();
    expect(needed).toBe(false);
  });

  it('returns true when snapshot creation throws', async () => {
    vi.mocked(supabase.auth.getSession).mockRejectedValueOnce(new Error('network'));

    const needed = await AuthStateRecoveryService.isRecoveryNeeded();
    expect(needed).toBe(true);
  });

  it('returns true when snapshot is invalid', async () => {
    // user without session → invalid snapshot
    vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
      data: { session: null },
      error: null,
    });
    vi.mocked(supabase.auth.getUser).mockResolvedValueOnce({
      data: { user: mockUser },
      error: null,
    });

    const needed = await AuthStateRecoveryService.isRecoveryNeeded();
    expect(needed).toBe(true);
  });
});

// ─── autoRecover ──────────────────────────────────────────────────────────────

describe('AuthStateRecoveryService – autoRecover()', () => {
  beforeEach(() => {
    resetStaticState();
    vi.mocked(UserService.getUserProfile).mockResolvedValue({ profile: null, error: null } as any);
    vi.mocked(UserService.getUserRole).mockResolvedValue({ role: null, error: null } as any);
  });

  it('returns null when no recovery is needed', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: null,
    });
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const result = await AuthStateRecoveryService.autoRecover();
    expect(result).toBeNull();
  });

  it('returns null when last attempt was within cooldown period', async () => {
    // Set lastRecoveryAttempt to now
    (AuthStateRecoveryService as any).lastRecoveryAttempt = new Date();

    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null }, error: null });
    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: mockUser }, error: null }); // invalid state

    const result = await AuthStateRecoveryService.autoRecover();
    expect(result).toBeNull();
  });

  it('triggers recovery when state is invalid and cooldown has passed', async () => {
    // Set lastRecoveryAttempt to 2 minutes ago (past cooldown)
    (AuthStateRecoveryService as any).lastRecoveryAttempt = new Date(Date.now() - 120000);

    // First call (isRecoveryNeeded) → invalid
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null }, error: null });
    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: mockUser }, error: null });
    vi.mocked(AuthRetryService.refreshSessionWithRetry).mockResolvedValue({
      success: false,
      data: null,
      error: new Error('fail'),
    } as any);
    vi.mocked(SessionService.validateSession).mockResolvedValue({ isValid: false } as any);

    const result = await AuthStateRecoveryService.autoRecover();
    expect(result).not.toBeNull();
  });
});

// ─── resetRecoveryState ───────────────────────────────────────────────────────

describe('AuthStateRecoveryService – resetRecoveryState()', () => {
  it('resets attempt counter and flags', () => {
    (AuthStateRecoveryService as any).recoveryAttempts = 5;
    (AuthStateRecoveryService as any).recoveryInProgress = true;
    (AuthStateRecoveryService as any).lastRecoveryAttempt = new Date();

    AuthStateRecoveryService.resetRecoveryState();

    expect((AuthStateRecoveryService as any).recoveryAttempts).toBe(0);
    expect((AuthStateRecoveryService as any).recoveryInProgress).toBe(false);
    expect((AuthStateRecoveryService as any).lastRecoveryAttempt).toBeNull();
  });
});

// ─── setupAutoBackup ──────────────────────────────────────────────────────────

describe('AuthStateRecoveryService – setupAutoBackup()', () => {
  const addEventListenerMock = vi.fn();
  const removeEventListenerMock = vi.fn();

  beforeEach(() => {
    resetStaticState();
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null }, error: null });
    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: null }, error: null });
    vi.mocked(UserService.getUserProfile).mockResolvedValue({ profile: null, error: null } as any);
    vi.mocked(UserService.getUserRole).mockResolvedValue({ role: null, error: null } as any);
    // Patch window with event listener stubs for this suite
    vi.stubGlobal('window', {
      ...window,
      addEventListener: addEventListenerMock,
      removeEventListener: removeEventListenerMock,
    });
  });

  it('returns a cleanup function', () => {
    const cleanup = AuthStateRecoveryService.setupAutoBackup();
    expect(typeof cleanup).toBe('function');
    cleanup();
  });

  it('unsubscribes auth listener and removes beforeunload on cleanup', () => {
    const unsubscribeMock = vi.fn();
    vi.mocked(supabase.auth.onAuthStateChange).mockReturnValueOnce({
      data: { subscription: { unsubscribe: unsubscribeMock } },
    } as any);

    const cleanup = AuthStateRecoveryService.setupAutoBackup();
    cleanup();

    expect(unsubscribeMock).toHaveBeenCalled();
    expect(removeEventListenerMock).toHaveBeenCalledWith('beforeunload', expect.any(Function));
  });

  it('calls backupAuthState when SIGNED_IN event fires', async () => {
    let capturedCallback: ((event: string, session: any) => void) | null = null;

    vi.mocked(supabase.auth.onAuthStateChange).mockImplementationOnce((cb) => {
      capturedCallback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } } as any;
    });

    AuthStateRecoveryService.setupAutoBackup();

    expect(capturedCallback).not.toBeNull();

    await capturedCallback!('SIGNED_IN', mockSession);

    expect(localStorage.setItem).toHaveBeenCalledWith(
      'mako_auth_backup',
      expect.any(String)
    );
  });

  it('calls backupAuthState when TOKEN_REFRESHED event fires', async () => {
    let capturedCallback: ((event: string, session: any) => void) | null = null;

    vi.mocked(supabase.auth.onAuthStateChange).mockImplementationOnce((cb) => {
      capturedCallback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } } as any;
    });

    AuthStateRecoveryService.setupAutoBackup();

    await capturedCallback!('TOKEN_REFRESHED', mockSession);

    expect(localStorage.setItem).toHaveBeenCalledWith(
      'mako_auth_backup',
      expect.any(String)
    );
  });

  it('does NOT call backupAuthState for SIGNED_OUT event', async () => {
    let capturedCallback: ((event: string, session: any) => void) | null = null;

    vi.mocked(supabase.auth.onAuthStateChange).mockImplementationOnce((cb) => {
      capturedCallback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } } as any;
    });

    AuthStateRecoveryService.setupAutoBackup();

    await capturedCallback!('SIGNED_OUT', null);

    expect(localStorage.setItem).not.toHaveBeenCalled();
  });
});

// ─── localStorage backup recovery path ───────────────────────────────────────

describe('AuthStateRecoveryService – localStorage backup edge cases', () => {
  beforeEach(() => {
    resetStaticState();
    vi.mocked(UserService.getUserProfile).mockResolvedValue({ profile: null, error: null } as any);
    vi.mocked(UserService.getUserRole).mockResolvedValue({ role: null, error: null } as any);
    vi.mocked(AuthRetryService.refreshSessionWithRetry).mockResolvedValue({
      success: false,
      data: null,
      error: new Error('fail'),
    } as any);
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null }, error: null });
    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: null }, error: null });
    vi.mocked(SessionService.validateSession).mockResolvedValue({ isValid: false } as any);
  });

  it('handles missing backup in localStorage gracefully', async () => {
    vi.mocked(localStorage.getItem).mockReturnValue(null);

    const result = await AuthStateRecoveryService.recoverAuthState({ fallbackToGuest: false });

    expect(result.success).toBe(false);
  });

  it('handles expired backup in localStorage gracefully', async () => {
    const oldBackup = {
      snapshot: { user: mockUser, session: null, profile: null, role: null, timestamp: new Date(), isValid: false },
      backupTime: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25h ago
      source: 'automatic',
    };
    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(oldBackup));

    const result = await AuthStateRecoveryService.recoverAuthState({ fallbackToGuest: false });

    expect(result.success).toBe(false);
  });
});
