import { User, Session, AuthError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { UserService, UserProfile } from './user.service';
import { ErrorHandlingService } from './errorHandling.service';
import { AuthRetryService } from './authRetry.service';

export interface AuthStateSnapshot {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  role: 'admin' | 'user' | null;
  timestamp: Date;
  isValid: boolean;
}

export interface RecoveryOptions {
  enableAutoRecovery: boolean;
  maxRecoveryAttempts: number;
  recoveryTimeout: number; // milliseconds
  fallbackToGuest: boolean;
  persistState: boolean;
}

export interface RecoveryResult {
  success: boolean;
  recovered: boolean;
  fallbackUsed: boolean;
  newState: AuthStateSnapshot | null;
  error?: Error;
  recoveryMethod?: 'session_refresh' | 'token_recovery' | 'local_storage' | 'fallback' | 'manual';
}

export interface AuthStateBackup {
  snapshot: AuthStateSnapshot;
  backupTime: Date;
  source: 'automatic' | 'manual' | 'before_error';
}

export class AuthStateRecoveryService {
  private static readonly STORAGE_KEY = 'mako_auth_backup';
  private static readonly MAX_BACKUP_AGE = 24 * 60 * 60 * 1000; // 24 hours
  private static readonly DEFAULT_OPTIONS: RecoveryOptions = {
    enableAutoRecovery: true,
    maxRecoveryAttempts: 3,
    recoveryTimeout: 30000, // 30 seconds
    fallbackToGuest: true,
    persistState: true
  };

  private static recoveryInProgress = false;
  private static lastRecoveryAttempt: Date | null = null;
  private static recoveryAttempts = 0;

  /**
   * Create a snapshot of current auth state
   */
  static async createStateSnapshot(): Promise<AuthStateSnapshot> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data: { user } } = await supabase.auth.getUser();
      
      let profile: UserProfile | null = null;
      let role: 'admin' | 'user' | null = null;

      if (user) {
        const { profile: userProfile } = await UserService.getUserProfile(user.id);
        const { role: userRole } = await UserService.getUserRole(user.id);
        profile = userProfile;
        role = userRole;
      }

      return {
        user,
        session,
        profile,
        role,
        timestamp: new Date(),
        isValid: this.validateStateSnapshot({ user, session, profile, role })
      };
    } catch (error) {
      console.error('Failed to create state snapshot:', error);
      return {
        user: null,
        session: null,
        profile: null,
        role: null,
        timestamp: new Date(),
        isValid: false
      };
    }
  }

  /**
   * Backup current auth state
   */
  static async backupAuthState(source: AuthStateBackup['source'] = 'automatic'): Promise<void> {
    try {
      const snapshot = await this.createStateSnapshot();
      
      const backup: AuthStateBackup = {
        snapshot,
        backupTime: new Date(),
        source
      };

      if (this.DEFAULT_OPTIONS.persistState) {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(backup));
      }

      console.log(`Auth state backed up (${source}):`, {
        hasUser: !!snapshot.user,
        hasSession: !!snapshot.session,
        isValid: snapshot.isValid
      });
    } catch (error) {
      console.error('Failed to backup auth state:', error);
    }
  }

  /**
   * Attempt to recover auth state
   */
  static async recoverAuthState(options: Partial<RecoveryOptions> = {}): Promise<RecoveryResult> {
    const config = { ...this.DEFAULT_OPTIONS, ...options };

    // Prevent concurrent recovery attempts
    if (this.recoveryInProgress) {
      return {
        success: false,
        recovered: false,
        fallbackUsed: false,
        newState: null,
        error: new Error('Recovery already in progress')
      };
    }

    // Check recovery attempt limits
    if (this.recoveryAttempts >= config.maxRecoveryAttempts) {
      console.warn('Max recovery attempts reached');
      return this.handleFallback(config);
    }

    this.recoveryInProgress = true;
    this.lastRecoveryAttempt = new Date();
    this.recoveryAttempts++;

    try {
      console.log(`Starting auth state recovery (attempt ${this.recoveryAttempts}/${config.maxRecoveryAttempts})`);

      // Try different recovery methods in order of preference
      const recoveryMethods = [
        () => this.recoverFromSession(),
        () => this.recoverFromTokens(),
        () => this.recoverFromLocalStorage(),
      ];

      for (const method of recoveryMethods) {
        try {
          const result = await Promise.race([
            method(),
            this.createTimeoutPromise(config.recoveryTimeout)
          ]);

          if (result.success) {
            this.resetRecoveryState();
            return result;
          }
        } catch (error) {
          console.warn('Recovery method failed:', error);
          continue;
        }
      }

      // All recovery methods failed
      return this.handleFallback(config);

    } catch (error) {
      console.error('Auth state recovery failed:', error);
      return this.handleFallback(config);
    } finally {
      this.recoveryInProgress = false;
    }
  }

  /**
   * Recover from current session
   */
  private static async recoverFromSession(): Promise<RecoveryResult> {
    try {
      console.log('Attempting session recovery...');
      
      const result = await AuthRetryService.refreshSessionWithRetry();
      
      if (result.success && result.data?.session) {
        const newState = await this.createStateSnapshot();
        
        if (newState.isValid) {
          console.log('Session recovery successful');
          return {
            success: true,
            recovered: true,
            fallbackUsed: false,
            newState,
            recoveryMethod: 'session_refresh'
          };
        }
      }

      return {
        success: false,
        recovered: false,
        fallbackUsed: false,
        newState: null,
        error: new Error('Session refresh failed or invalid')
      };
    } catch (error) {
      return {
        success: false,
        recovered: false,
        fallbackUsed: false,
        newState: null,
        error: error as Error
      };
    }
  }

  /**
   * Recover from stored tokens
   */
  private static async recoverFromTokens(): Promise<RecoveryResult> {
    try {
      console.log('Attempting token recovery...');
      
      // Try to get session from Supabase client
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (error || !session) {
        throw new Error('No valid tokens found');
      }

      // Validate the session
      const { isValid } = await SessionService.validateSession(session);
      
      if (!isValid) {
        throw new Error('Session validation failed');
      }

      const newState = await this.createStateSnapshot();
      
      if (newState.isValid) {
        console.log('Token recovery successful');
        return {
          success: true,
          recovered: true,
          fallbackUsed: false,
          newState,
          recoveryMethod: 'token_recovery'
        };
      }

      throw new Error('Recovered state is invalid');
    } catch (error) {
      return {
        success: false,
        recovered: false,
        fallbackUsed: false,
        newState: null,
        error: error as Error
      };
    }
  }

  /**
   * Recover from local storage backup
   */
  private static async recoverFromLocalStorage(): Promise<RecoveryResult> {
    try {
      console.log('Attempting local storage recovery...');
      
      const backupData = localStorage.getItem(this.STORAGE_KEY);
      if (!backupData) {
        throw new Error('No backup found in local storage');
      }

      const backup: AuthStateBackup = JSON.parse(backupData);
      
      // Check if backup is too old
      const backupAge = Date.now() - new Date(backup.backupTime).getTime();
      if (backupAge > this.MAX_BACKUP_AGE) {
        throw new Error('Backup is too old');
      }

      // Validate backup state
      if (!backup.snapshot.isValid || !backup.snapshot.user) {
        throw new Error('Backup state is invalid');
      }

      // Try to restore session using backup info
      // Note: This is a simplified approach - in practice, you might need
      // to implement more sophisticated token restoration
      console.log('Local storage recovery - backup found but session restoration not implemented');
      
      return {
        success: false,
        recovered: false,
        fallbackUsed: false,
        newState: null,
        error: new Error('Local storage recovery not fully implemented')
      };
    } catch (error) {
      return {
        success: false,
        recovered: false,
        fallbackUsed: false,
        newState: null,
        error: error as Error
      };
    }
  }

  /**
   * Handle fallback scenarios
   */
  private static async handleFallback(config: RecoveryOptions): Promise<RecoveryResult> {
    if (config.fallbackToGuest) {
      console.log('Using guest fallback');
      
      const guestState: AuthStateSnapshot = {
        user: null,
        session: null,
        profile: null,
        role: null,
        timestamp: new Date(),
        isValid: true // Guest state is considered valid
      };

      return {
        success: true,
        recovered: false,
        fallbackUsed: true,
        newState: guestState,
        recoveryMethod: 'fallback'
      };
    }

    return {
      success: false,
      recovered: false,
      fallbackUsed: false,
      newState: null,
      error: new Error('All recovery methods failed and fallback disabled')
    };
  }

  /**
   * Validate state snapshot
   */
  private static validateStateSnapshot(state: Partial<AuthStateSnapshot>): boolean {
    // If user exists, session should also exist
    if (state.user && !state.session) {
      return false;
    }

    // If session exists, it should not be expired
    if (state.session) {
      const expiresAt = new Date(state.session.expires_at! * 1000);
      if (expiresAt <= new Date()) {
        return false;
      }
    }

    return true;
  }


  /**
   * Check if recovery is needed
   */
  static async isRecoveryNeeded(): Promise<boolean> {
    try {
      const currentState = await this.createStateSnapshot();
      return !currentState.isValid;
    } catch (error) {
      return true; // If we can't check, assume recovery is needed
    }
  }

  /**
   * Auto-recovery with intelligent triggers
   */
  static async autoRecover(): Promise<RecoveryResult | null> {
    if (!this.DEFAULT_OPTIONS.enableAutoRecovery) {
      return null;
    }

    const needsRecovery = await this.isRecoveryNeeded();
    if (!needsRecovery) {
      return null;
    }

    // Don't auto-recover too frequently
    if (this.lastRecoveryAttempt) {
      const timeSinceLastAttempt = Date.now() - this.lastRecoveryAttempt.getTime();
      if (timeSinceLastAttempt < 60000) { // 1 minute cooldown
        return null;
      }
    }

    console.log('Auto-recovery triggered');
    return this.recoverAuthState();
  }

  /**
   * Cleanup and reset recovery state
   */
  static resetRecoveryState(): void {
    this.recoveryAttempts = 0;
    this.lastRecoveryAttempt = null;
    this.recoveryInProgress = false;
    console.log('Recovery state reset');
  }



  /**
   * Utility methods
   */
  private static createTimeoutPromise(timeout: number): Promise<RecoveryResult> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Recovery timeout after ${timeout}ms`));
      }, timeout);
    });
  }

  /**
   * Setup automatic backup on auth state changes
   */
  static setupAutoBackup(): () => void {
    // Never await a Supabase call inside this callback. supabase-js runs it while
    // the token refresh still holds the auth lock (client.ts passes a custom
    // lock), and backupAuthState calls getSession(), which queues behind that
    // lock. Awaiting it here deadlocks the refresh, and every later request
    // hangs on getSession() for its access token (MAK-229). Run the backup on
    // the next tick, after the refresh has released the lock.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event) => {
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          setTimeout(() => {
            void this.backupAuthState('automatic');
          }, 0);
        }
      }
    );

    // Also backup before page unload
    const handleBeforeUnload = () => {
      this.backupAuthState('before_error');
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    // Return cleanup function
    return () => {
      subscription.unsubscribe();
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }
}

export default AuthStateRecoveryService;