import { supabase } from '@/integrations/supabase/client';
import { withTimeout } from '@/utils/promiseUtils';

/**
 * Startup Session Validator
 * 
 * Aggressively validates cached tokens on app load BEFORE any auth state is processed.
 * This prevents stale localStorage tokens from causing authenticated UI with invalid sessions.
 */

interface ValidationResult {
  isValid: boolean;
  wasCleared: boolean;
  reason?: string;
}

class StartupSessionValidatorService {
  private static instance: StartupSessionValidatorService | null = null;
  private validationComplete = false;
  private validationPromise: Promise<ValidationResult> | null = null;
  private externallyValidated = false; // Set when TOKEN_REFRESHED confirms valid session
  // Resolvers for in-flight getSession() races — resolved when TOKEN_REFRESHED fires early
  private externalValidationResolvers: Array<(r: ValidationResult) => void> = [];

  static getInstance(): StartupSessionValidatorService {
    if (!this.instance) {
      this.instance = new StartupSessionValidatorService();
    }
    return this.instance;
  }

  /**
   * Check if validation has been completed
   */
  isValidationComplete(): boolean {
    return this.validationComplete || this.externallyValidated;
  }

  /**
   * Mark session as externally validated (e.g., from TOKEN_REFRESHED event)
   * This prevents the validator from clearing tokens if it times out after a successful refresh
   */
  markAsValidated(): void {
    console.log('✅ STARTUP VALIDATOR: Externally marked as validated (token refresh received)');
    this.externallyValidated = true;
    this.validationComplete = true;
    // Unblock any in-flight getSession() race in performValidation()
    const resolvers = this.externalValidationResolvers.splice(0);
    resolvers.forEach(resolve =>
      resolve({ isValid: true, wasCleared: false, reason: 'Externally validated (TOKEN_REFRESHED)' })
    );
  }

  /**
   * Check if session was externally validated
   */
  isExternallyValidated(): boolean {
    return this.externallyValidated;
  }

  /**
   * Validate cached session on startup - must be called BEFORE auth context initializes
   * Returns a promise that resolves when validation is complete
   */
  async validateOnStartup(): Promise<ValidationResult> {
    // If validation is already in progress, return existing promise
    if (this.validationPromise) {
      return this.validationPromise;
    }

    // If already validated, return immediately
    if (this.validationComplete) {
      return { isValid: true, wasCleared: false, reason: 'Already validated' };
    }

    console.log('🔐 STARTUP VALIDATOR: Starting aggressive session validation...');
    
    // Wrap entire validation with a hard 12-second global timeout
    this.validationPromise = (async () => {
      try {
        const result = await withTimeout(
          this.performValidation(),
          12000,
          'Overall startup validation timeout'
        );
        return result;
      } catch (error: any) {
        console.log('⚠️ STARTUP VALIDATOR: Global timeout hit, clearing stale tokens');

        // CRITICAL FIX: Check if externally validated BEFORE clearing
        if (this.externallyValidated) {
          console.log('⚠️ STARTUP VALIDATOR: Global timeout but externally validated - treating as valid session');
          return { isValid: true, wasCleared: false, reason: 'Global timeout but externally validated' };
        }

        await this.clearStaleTokens('Global validation timeout');
        return { isValid: false, wasCleared: true, reason: 'Global timeout' };
      }
    })();
    
    try {
      const result = await this.validationPromise;
      this.validationComplete = true;
      return result;
    } finally {
      this.validationPromise = null;
    }
  }

  private async performValidation(): Promise<ValidationResult> {
    const startTime = Date.now();

    try {
      // Step 1: Check if there are any cached tokens in localStorage
      const hasCachedTokens = this.hasCachedAuthTokens();
      
      if (!hasCachedTokens) {
        console.log('🔐 STARTUP VALIDATOR: No cached tokens found, skipping validation');
        return { isValid: true, wasCleared: false, reason: 'No cached tokens' };
      }

      console.log('🔐 STARTUP VALIDATOR: Found cached tokens, validating with server...');

      // Short-circuit: if TOKEN_REFRESHED already fired before we got here, skip getSession()
      if (this.externallyValidated) {
        console.log('✅ STARTUP VALIDATOR: Already externally validated - skipping getSession()');
        return { isValid: true, wasCleared: false, reason: 'Externally validated (TOKEN_REFRESHED)' };
      }

      // Step 2: Get cached session WITH TIMEOUT (critical fix for stale token hangs)
      // Race getSession() against TOKEN_REFRESHED — whichever fires first wins.
      // This prevents the validator from blocking initializeAuth() for the full 5s
      // when a token refresh completes early (the common cold-start scenario).
      let session = null;
      let sessionError = null;
      let externalResolve: ((r: ValidationResult) => void) | null = null;

      try {
        const externalValidationPromise = new Promise<ValidationResult>((resolve) => {
          externalResolve = resolve;
          this.externalValidationResolvers.push(resolve);
        });

        type RaceResult =
          | { type: 'session'; data: Awaited<ReturnType<typeof supabase.auth.getSession>> }
          | { type: 'external'; data: ValidationResult };

        const raceResult = await Promise.race<RaceResult>([
          withTimeout(
            supabase.auth.getSession(),
            5000,
            'Session fetch timeout'
          ).then(data => ({ type: 'session' as const, data })),
          externalValidationPromise.then(data => ({ type: 'external' as const, data }))
        ]);

        // Clean up our resolver if getSession() won (markAsValidated already spliced it if external won)
        if (externalResolve) {
          const idx = this.externalValidationResolvers.indexOf(externalResolve);
          if (idx > -1) this.externalValidationResolvers.splice(idx, 1);
        }

        if (raceResult.type === 'external') {
          console.log('✅ STARTUP VALIDATOR: TOKEN_REFRESHED won the race - skipping remaining validation');
          return raceResult.data;
        }

        session = raceResult.data.data.session;
        sessionError = raceResult.data.error;
      } catch (timeoutError: any) {
        // Clean up any stale resolver that wasn't removed before the throw
        if (externalResolve) {
          const idx = this.externalValidationResolvers.indexOf(externalResolve);
          if (idx > -1) this.externalValidationResolvers.splice(idx, 1);
        }

        console.log('⚠️ STARTUP VALIDATOR: getSession() timed out after 5s', {
          externallyValidated: this.externallyValidated,
          timestamp: new Date().toISOString()
        });

        // CRITICAL FIX: Check if externally validated BEFORE clearing
        if (this.externallyValidated) {
          console.log('✅ STARTUP VALIDATOR: Timeout but externally validated - skipping token clear');
          return { isValid: true, wasCleared: false, reason: 'Timeout but externally validated' };
        }

        console.log('🧹 STARTUP VALIDATOR: Not externally validated, clearing stale tokens');
        await this.clearStaleTokens('Session fetch timeout');
        return { isValid: false, wasCleared: true, reason: 'Session fetch timeout' };
      }
      
      if (sessionError || !session) {
        console.log('🔐 STARTUP VALIDATOR: No valid session in cache', {
          error: sessionError?.message,
          hasSession: !!session
        });
        // Clear stale tokens if session is invalid
        if (hasCachedTokens) {
          await this.clearStaleTokens('No valid session');
          return { isValid: false, wasCleared: true, reason: 'No valid session' };
        }
        return { isValid: false, wasCleared: false, reason: 'No session' };
      }

      // Step 3: Check if session is expired based on expires_at
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = session.expires_at || 0;
      const isExpired = expiresAt <= now;
      
      if (isExpired) {
        console.log('🔐 STARTUP VALIDATOR: Session expired based on timestamp', {
          expiresAt: new Date(expiresAt * 1000).toISOString(),
          now: new Date(now * 1000).toISOString()
        });
        await this.clearStaleTokens('Session expired');
        return { isValid: false, wasCleared: true, reason: 'Session expired' };
      }

      // Step 4: Validate with server using getUser() - this is the critical check
      console.log('🔐 STARTUP VALIDATOR: Validating token with server...');
      
      try {
        const { data: { user }, error: userError } = await withTimeout(
          supabase.auth.getUser(),
          5000, // 5 second timeout - consistent with getSession timeout
          'Startup validation timeout'
        );

        const validationTime = Date.now() - startTime;

        if (userError) {
          const isNetworkError = this.isNetworkError(userError);
          
          if (isNetworkError) {
            console.log(`⚠️ STARTUP VALIDATOR: Network error after ${validationTime}ms, preserving session`, {
              error: userError.message
            });
            // For network errors, trust the cached session temporarily
            return { isValid: true, wasCleared: false, reason: 'Network error - session preserved' };
          }

          console.log(`❌ STARTUP VALIDATOR: Server rejected token after ${validationTime}ms`, {
            error: userError.message
          });
          await this.clearStaleTokens('Server rejected token');
          return { isValid: false, wasCleared: true, reason: 'Server rejected token' };
        }

        if (!user) {
          console.log(`❌ STARTUP VALIDATOR: No user returned after ${validationTime}ms`);
          await this.clearStaleTokens('No user returned');
          return { isValid: false, wasCleared: true, reason: 'No user returned' };
        }

        console.log(`✅ STARTUP VALIDATOR: Session validated successfully in ${validationTime}ms`, {
          userId: user.id,
          email: user.email
        });

        return { isValid: true, wasCleared: false, reason: 'Valid session' };

      } catch (validationError: any) {
        const validationTime = Date.now() - startTime;
        const isTimeoutOrNetwork = this.isTimeoutOrNetworkError(validationError);

        if (isTimeoutOrNetwork) {
          console.log(`⚠️ STARTUP VALIDATOR: Timeout/network error after ${validationTime}ms, preserving session`);
          return { isValid: true, wasCleared: false, reason: 'Timeout - session preserved' };
        }

        console.log(`❌ STARTUP VALIDATOR: Validation failed after ${validationTime}ms`, {
          error: validationError.message
        });
        await this.clearStaleTokens('Validation error');
        return { isValid: false, wasCleared: true, reason: 'Validation error' };
      }

    } catch (error: any) {
      console.error('❌ STARTUP VALIDATOR: Critical error during validation:', error.message);
      // On critical errors, clear tokens to be safe
      await this.clearStaleTokens('Critical error');
      return { isValid: false, wasCleared: true, reason: 'Critical error' };
    }
  }

  /**
   * Check if there are any cached auth tokens in localStorage
   */
  private hasCachedAuthTokens(): boolean {
    try {
      const authKeys = Object.keys(localStorage).filter(key =>
        key.startsWith('sb-') || 
        key.includes('supabase') ||
        key.includes('auth-token')
      );
      return authKeys.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Clear stale tokens from localStorage and sign out locally
   */
  private async clearStaleTokens(reason: string): Promise<void> {
    // CRITICAL: Skip clearing if session was externally validated (e.g., TOKEN_REFRESHED)
    if (this.externallyValidated) {
      console.log('⚠️ STARTUP VALIDATOR: Skipping token clear - externally validated via TOKEN_REFRESHED');
      return;
    }

    console.log(`🧹 STARTUP VALIDATOR: Clearing stale tokens - ${reason}`);

    try {
      // Clear Supabase auth keys from localStorage
      const keysToRemove = Object.keys(localStorage).filter(key =>
        key.startsWith('sb-') || 
        key.includes('supabase') ||
        key.includes('auth-token')
      );

      keysToRemove.forEach(key => {
        localStorage.removeItem(key);
        console.log(`🧹 STARTUP VALIDATOR: Removed localStorage key: ${key}`);
      });

      // Clear sessionStorage
      const sessionKeysToRemove = Object.keys(sessionStorage).filter(key =>
        key.startsWith('sb-') || 
        key.includes('supabase') ||
        key.includes('auth-token')
      );

      sessionKeysToRemove.forEach(key => {
        sessionStorage.removeItem(key);
      });

      // Force local signout to clear Supabase internal state
      try {
        await withTimeout(supabase.auth.signOut({ scope: 'local' }), 5000);
      } catch (signOutError) {
        // Ignore signout errors - tokens are already cleared
        console.log('⚠️ STARTUP VALIDATOR: Signout error (ignored):', signOutError);
      }

      console.log(`✅ STARTUP VALIDATOR: Cleared ${keysToRemove.length} stale tokens`);

    } catch (error) {
      console.error('❌ STARTUP VALIDATOR: Error clearing tokens:', error);
    }
  }

  /**
   * Check if error is a network-related error
   */
  private isNetworkError(error: any): boolean {
    const message = error?.message?.toLowerCase() || '';
    return (
      message.includes('network') ||
      message.includes('fetch') ||
      message.includes('failed to fetch') ||
      message.includes('connection') ||
      error?.name === 'NetworkError'
    );
  }

  /**
   * Check if error is timeout or network related
   */
  private isTimeoutOrNetworkError(error: any): boolean {
    const message = error?.message?.toLowerCase() || '';
    return (
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('fetch') ||
      message.includes('aborted') ||
      error?.name === 'AbortError' ||
      error?.name === 'NetworkError'
    );
  }

  /**
   * Reset validation state (useful for testing or manual re-validation)
   */
  reset(): void {
    this.validationComplete = false;
    this.validationPromise = null;
    this.externallyValidated = false;
    this.externalValidationResolvers = [];
    console.log('🔄 STARTUP VALIDATOR: Reset validation state');
  }
}

export const startupSessionValidator = StartupSessionValidatorService.getInstance();
export default StartupSessionValidatorService;
