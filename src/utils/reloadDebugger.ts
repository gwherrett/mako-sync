/**
 * Reload Debugger Utility
 *
 * Specialized tool for debugging auth issues on page reload.
 * Captures state before/after reload and provides detailed analytics.
 */

declare global {
  interface Window {
    /** Console access for debugging. */
    ReloadDebugger?: typeof ReloadDebuggerService;
  }
}

interface ReloadDebugEntry {
  timestamp: number;
  event: string;
  phase: 'pre-reload' | 'post-reload' | 'startup' | 'runtime';
  data: Record<string, unknown>;
  localStorage: Record<string, unknown>;
  sessionStorage: Record<string, unknown>;
}

/** What getSupabaseState finds in the stored Supabase auth token. */
type SupabaseStateSummary =
  | { hasSession: boolean; expiresAt: string | null; isExpired: boolean | null; userId?: string; userEmail?: string }
  | { noTokenFound: true }
  | { error: string };

/** Auth keys before and after a reload. `error` is set when either snapshot is missing. */
interface AuthStateChanges {
  error?: string;
  preReload?: { authKeysCount: number; authKeys: string[] };
  postReload?: { authKeysCount: number; authKeys: string[] };
  changes?: { keysRemoved: string[]; keysAdded: string[]; tokensCleared: boolean };
}

/** The reload report. Only `error` is set when there is no active session. */
interface ReloadReport {
  error?: string;
  session?: { id: string; reloadCount: number; startTime: string; lastReloadTime: string | null; duration: number };
  timeline?: Array<{ time: string; event: string; phase: ReloadDebugEntry['phase']; relativeTime: number }>;
  preReloadState?: ReloadDebugEntry;
  postReloadState?: ReloadDebugEntry;
  authStateChanges?: AuthStateChanges;
  potentialIssues?: string[];
}

interface ReloadSession {
  sessionId: string;
  reloadCount: number;
  entries: ReloadDebugEntry[];
  startTime: number;
  lastReloadTime?: number;
}

class ReloadDebuggerService {
  private static readonly STORAGE_KEY = 'mako_reload_debug';
  private static readonly SESSION_KEY = 'mako_reload_session_id';
  private static currentSession: ReloadSession | null = null;

  /**
   * Initialize reload debugging - call this on app startup
   */
  static initialize(): void {
    console.log('🔄 RELOAD DEBUGGER: Initializing...');

    // Check if this is a reload or fresh load
    const navEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const wasReload = navEntry?.type === 'reload';
    const sessionId = sessionStorage.getItem(this.SESSION_KEY);

    if (wasReload && sessionId) {
      // This is a reload - load previous session
      this.loadSession(sessionId);
      this.logEvent('reload-detected', 'post-reload', {
        reloadType: 'page-reload',
        performanceNavigation: performance.getEntriesByType('navigation')[0]
      });
    } else {
      // Fresh load - create new session
      this.createNewSession();
      this.logEvent('fresh-load', 'startup', {
        performanceNavigation: performance.getEntriesByType('navigation')[0]
      });
    }

    // Capture startup auth state
    this.captureAuthSnapshot('startup-begin');

    // Setup reload listener
    window.addEventListener('beforeunload', () => {
      this.logEvent('before-unload', 'pre-reload', {
        willReload: true
      });
      this.captureAuthSnapshot('pre-reload');
      this.saveSession();
    });

    console.log('🔄 RELOAD DEBUGGER: Initialized', {
      wasReload,
      sessionId: this.currentSession?.sessionId,
      reloadCount: this.currentSession?.reloadCount
    });
  }

  /**
   * Create a new debug session
   */
  private static createNewSession(): void {
    const sessionId = `reload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    this.currentSession = {
      sessionId,
      reloadCount: 0,
      entries: [],
      startTime: Date.now()
    };

    sessionStorage.setItem(this.SESSION_KEY, sessionId);
  }

  /**
   * Load existing session from localStorage
   */
  private static loadSession(sessionId: string): void {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.sessionId === sessionId) {
          this.currentSession = {
            ...parsed,
            reloadCount: (parsed.reloadCount || 0) + 1,
            lastReloadTime: Date.now()
          };

          console.log('🔄 RELOAD DEBUGGER: Loaded existing session', {
            sessionId,
            reloadCount: this.currentSession.reloadCount,
            entriesCount: this.currentSession.entries.length
          });

          return;
        }
      }

      // Fallback: create new session
      this.createNewSession();
    } catch (error) {
      console.error('🔄 RELOAD DEBUGGER: Failed to load session:', error);
      this.createNewSession();
    }
  }

  /**
   * Save current session to localStorage
   */
  private static saveSession(): void {
    if (!this.currentSession) return;

    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.currentSession));
      console.log('🔄 RELOAD DEBUGGER: Session saved', {
        entriesCount: this.currentSession.entries.length
      });
    } catch (error) {
      console.error('🔄 RELOAD DEBUGGER: Failed to save session:', error);
    }
  }

  /**
   * Log a debug event
   */
  static logEvent(event: string, phase: ReloadDebugEntry['phase'], data: Record<string, unknown> = {}): void {
    if (!this.currentSession) {
      console.warn('🔄 RELOAD DEBUGGER: No active session');
      return;
    }

    const entry: ReloadDebugEntry = {
      timestamp: Date.now(),
      event,
      phase,
      data,
      localStorage: this.captureLocalStorage(),
      sessionStorage: this.captureSessionStorage()
    };

    this.currentSession.entries.push(entry);

    console.log(`🔄 RELOAD DEBUGGER [${phase}]: ${event}`, data);
  }

  /**
   * Capture current auth state snapshot
   */
  static captureAuthSnapshot(label: string): {
    label: string;
    timestamp: number;
    localStorage: { hasAuthTokens: boolean; authKeys: string[] };
    sessionStorage: { hasAuthTokens: boolean; authKeys: string[] };
    supabaseState: SupabaseStateSummary;
    performance: { timeOrigin: number; timing: unknown; navigation: unknown };
  } {
    const snapshot = {
      label,
      timestamp: Date.now(),
      localStorage: {
        hasAuthTokens: this.hasAuthTokensInStorage('localStorage'),
        authKeys: this.getAuthKeysFromStorage('localStorage')
      },
      sessionStorage: {
        hasAuthTokens: this.hasAuthTokensInStorage('sessionStorage'),
        authKeys: this.getAuthKeysFromStorage('sessionStorage')
      },
      supabaseState: this.getSupabaseState(),
      performance: {
        timeOrigin: performance.timeOrigin,
        timing: performance.timing?.toJSON?.() || {},
        navigation: performance.getEntriesByType('navigation')[0] || {}
      }
    };

    this.logEvent(`auth-snapshot-${label}`, 'runtime', snapshot);

    return snapshot;
  }

  /**
   * Capture localStorage state
   */
  private static captureLocalStorage(): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          if (key.includes('auth') || key.includes('sb-') || key.includes('supabase')) {
            result[key] = this.safeJsonParse(localStorage.getItem(key));
          }
        }
      }
    } catch (error) {
      result._error = String(error);
    }

    return result;
  }

  /**
   * Capture sessionStorage state
   */
  private static captureSessionStorage(): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key) {
          if (key.includes('auth') || key.includes('sb-') || key.includes('supabase') || key.includes('mako')) {
            result[key] = this.safeJsonParse(sessionStorage.getItem(key));
          }
        }
      }
    } catch (error) {
      result._error = String(error);
    }

    return result;
  }

  /**
   * Check if auth tokens exist in storage
   */
  private static hasAuthTokensInStorage(storageType: 'localStorage' | 'sessionStorage'): boolean {
    const storage = storageType === 'localStorage' ? localStorage : sessionStorage;

    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && (key.startsWith('sb-') || key.includes('auth-token'))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get auth keys from storage
   */
  private static getAuthKeysFromStorage(storageType: 'localStorage' | 'sessionStorage'): string[] {
    const storage = storageType === 'localStorage' ? localStorage : sessionStorage;
    const keys: string[] = [];

    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && (key.includes('auth') || key.startsWith('sb-') || key.includes('supabase'))) {
        keys.push(key);
      }
    }

    return keys;
  }

  /**
   * Get Supabase state (if available)
   */
  private static getSupabaseState(): SupabaseStateSummary {
    try {
      // Try to get session from localStorage
      const authKeys = this.getAuthKeysFromStorage('localStorage');
      const authTokenKey = authKeys.find(k => k.includes('auth-token'));

      if (authTokenKey) {
        const tokenData = localStorage.getItem(authTokenKey);
        if (tokenData) {
          const parsed = JSON.parse(tokenData);
          return {
            hasSession: !!parsed,
            expiresAt: parsed?.expires_at ? new Date(parsed.expires_at * 1000).toISOString() : null,
            isExpired: parsed?.expires_at ? parsed.expires_at <= Math.floor(Date.now() / 1000) : null,
            userId: parsed?.user?.id,
            userEmail: parsed?.user?.email
          };
        }
      }

      return { noTokenFound: true };
    } catch (error) {
      return { error: String(error) };
    }
  }

  /**
   * Safe JSON parse
   */
  private static safeJsonParse(value: string | null): unknown {
    if (!value) return null;

    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  /**
   * Get detailed reload report
   */
  static getReport(): ReloadReport {
    if (!this.currentSession) {
      return { error: 'No active session' };
    }

    const entries = this.currentSession.entries;

    return {
      session: {
        id: this.currentSession.sessionId,
        reloadCount: this.currentSession.reloadCount,
        startTime: new Date(this.currentSession.startTime).toISOString(),
        lastReloadTime: this.currentSession.lastReloadTime
          ? new Date(this.currentSession.lastReloadTime).toISOString()
          : null,
        duration: Date.now() - this.currentSession.startTime
      },
      timeline: entries.map(e => ({
        time: new Date(e.timestamp).toISOString(),
        event: e.event,
        phase: e.phase,
        relativeTime: e.timestamp - this.currentSession!.startTime
      })),
      preReloadState: entries.filter(e => e.phase === 'pre-reload').slice(-1)[0],
      postReloadState: entries.filter(e => e.phase === 'post-reload')[0],
      authStateChanges: this.analyzeAuthStateChanges(entries),
      potentialIssues: this.identifyPotentialIssues(entries)
    };
  }

  /**
   * Analyze auth state changes across reload
   */
  private static analyzeAuthStateChanges(entries: ReloadDebugEntry[]): AuthStateChanges {
    const preReload = entries.filter(e => e.phase === 'pre-reload').slice(-1)[0];
    const postReload = entries.filter(e => e.phase === 'post-reload')[0];

    if (!preReload || !postReload) {
      return { error: 'Missing pre/post reload snapshots' };
    }

    const preAuthKeys = Object.keys(preReload.localStorage).filter(k =>
      k.includes('auth') || k.startsWith('sb-')
    );
    const postAuthKeys = Object.keys(postReload.localStorage).filter(k =>
      k.includes('auth') || k.startsWith('sb-')
    );

    return {
      preReload: {
        authKeysCount: preAuthKeys.length,
        authKeys: preAuthKeys
      },
      postReload: {
        authKeysCount: postAuthKeys.length,
        authKeys: postAuthKeys
      },
      changes: {
        keysRemoved: preAuthKeys.filter(k => !postAuthKeys.includes(k)),
        keysAdded: postAuthKeys.filter(k => !preAuthKeys.includes(k)),
        tokensCleared: preAuthKeys.length > 0 && postAuthKeys.length === 0
      }
    };
  }

  /**
   * Identify potential issues
   */
  private static identifyPotentialIssues(entries: ReloadDebugEntry[]): string[] {
    const issues: string[] = [];

    // Check if tokens were cleared during reload
    const authChanges = this.analyzeAuthStateChanges(entries);
    if (authChanges.changes?.tokensCleared) {
      issues.push('CRITICAL: Auth tokens were cleared during reload');
    }

    // Check for timeouts
    const timeoutEvents = entries.filter(e =>
      e.event.includes('timeout') ||
      (typeof e.data?.error === 'string' && e.data.error.includes('timeout'))
    );
    if (timeoutEvents.length > 0) {
      issues.push(`WARNING: ${timeoutEvents.length} timeout event(s) detected`);
    }

    // Check reload duration
    const preReload = entries.filter(e => e.phase === 'pre-reload').slice(-1)[0];
    const postReload = entries.filter(e => e.phase === 'post-reload')[0];
    if (preReload && postReload) {
      const reloadDuration = postReload.timestamp - preReload.timestamp;
      if (reloadDuration > 5000) {
        issues.push(`WARNING: Reload took ${reloadDuration}ms (>5s)`);
      }
    }

    return issues;
  }

  /**
   * Export report as JSON
   */
  static exportReport(): string {
    return JSON.stringify(this.getReport(), null, 2);
  }

  /**
   * Clear debug session
   */
  static clear(): void {
    localStorage.removeItem(this.STORAGE_KEY);
    sessionStorage.removeItem(this.SESSION_KEY);
    this.currentSession = null;
    console.log('🔄 RELOAD DEBUGGER: Cleared');
  }

  /**
   * Print report to console
   */
  static printReport(): void {
    const report = this.getReport();
    console.log('🔄 RELOAD DEBUGGER REPORT:', report);
    console.table(report.timeline);

    if (report.potentialIssues?.length > 0) {
      console.warn('🔄 RELOAD DEBUGGER ISSUES:', report.potentialIssues);
    }
  }
}

// Global access for debugging
window.ReloadDebugger = ReloadDebuggerService;

export default ReloadDebuggerService;
export { ReloadDebuggerService };
