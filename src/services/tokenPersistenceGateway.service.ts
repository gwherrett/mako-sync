import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

/**
 * Token Persistence Gateway Service
 *
 * Solves the race condition where TOKEN_REFRESHED fires before the token
 * is actually persisted to localStorage, causing queries to fail with
 * stale/missing tokens.
 *
 * Also ensures Supabase client's internal auth state is ready before
 * allowing queries to proceed.
 *
 * Console log prefix: 🔐 TOKEN GATEWAY
 */

const STORAGE_KEY_PREFIX = 'sb-';
const DEFAULT_MAX_WAIT_MS = 300;
const POLL_INTERVAL_MS = 10;

class TokenPersistenceGatewayService {
  private static instance: TokenPersistenceGatewayService | null = null;
  private tokenReady = false;
  private sessionVerified = false; // true once setSession has succeeded — skip on subsequent events
  private pendingCallbacks: (() => void)[] = [];
  persistenceTimedOut = false; // true when polling window expired before token appeared

  static getInstance(): TokenPersistenceGatewayService {
    if (!this.instance) {
      this.instance = new TokenPersistenceGatewayService();
    }
    return this.instance;
  }

  /**
   * Wait for token to appear in localStorage matching the session
   * AND verify Supabase client can use it for queries.
   * Returns true when ready, false after timeout (non-blocking)
   *
   * @param options.skipSetSession - Skip the setSession verification step (use for TOKEN_REFRESHED
   *   events where Supabase has already refreshed internally — avoids redundant round-trips)
   */
  async waitForTokenPersistence(
    session: Session,
    maxWaitMs = DEFAULT_MAX_WAIT_MS,
    options?: { skipSetSession?: boolean }
  ): Promise<boolean> {
    const startTime = Date.now();
    const accessToken = session.access_token;

    console.log('🔐 TOKEN GATEWAY: Starting token persistence check...', {
      maxWaitMs,
      skipSetSession: options?.skipSetSession ?? false,
      tokenPrefix: accessToken.substring(0, 20) + '...'
    });

    // Quick check - token might already be persisted
    const alreadyPersisted = this.isTokenPersisted(accessToken);
    console.log('🔐 TOKEN GATEWAY: Token in localStorage:', alreadyPersisted);

    if (alreadyPersisted) {
      // Skip setSession if:
      // 1. Caller explicitly opts out (TOKEN_REFRESHED path), OR
      // 2. We've already verified the session once this sign-in — covers the case where
      //    Supabase's own _onVisibilityChanged emits a synthetic SIGNED_IN on tab restore,
      //    which would otherwise race setSession against a browser-throttled network call.
      if (options?.skipSetSession || this.sessionVerified) {
        console.log('🔐 TOKEN GATEWAY: Token persisted, skipping setSession', {
          reason: options?.skipSetSession ? 'caller-opted-out' : 'already-verified'
        });
        this.sessionVerified = true; // Prevent subsequent SIGNED_IN from redundantly calling setSession
        this.markTokenReady();
        return true;
      }

      // First sign-in only: verify Supabase client is ready by setting the session.
      // Use a timeout to prevent hanging — 1000ms for cold-start tolerance.
      try {
        const setSessionPromise = supabase.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token
        });

        // Race against a 1000ms timeout
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('setSession timeout')), 1000);
        });

        await Promise.race([setSessionPromise, timeoutPromise]);
        const elapsed = Date.now() - startTime;
        console.log(`🔐 TOKEN GATEWAY: Token verified and client ready (${elapsed}ms)`);
        this.sessionVerified = true;
        this.markTokenReady();
        return true;
      } catch (error) {
        const elapsed = Date.now() - startTime;
        console.warn(`🔐 TOKEN GATEWAY: setSession failed/timeout after ${elapsed}ms, proceeding anyway:`, error);
        // Supabase's internal setSession lock may still be held — wait for it to release
        // before marking ready so DB writes don't fire into a locked client.
        await new Promise<void>(resolve => setTimeout(resolve, 1500));
        this.sessionVerified = true; // don't retry setSession on subsequent events
        this.markTokenReady();
        return true;
      }
    }

    console.log('🔐 TOKEN GATEWAY: Polling for token persistence...');

    return new Promise<boolean>((resolve) => {
      const checkInterval = setInterval(async () => {
        const elapsed = Date.now() - startTime;

        if (this.isTokenPersisted(accessToken)) {
          clearInterval(checkInterval);
          console.log(`🔐 TOKEN GATEWAY: Token persisted (${elapsed}ms)`);
          this.markTokenReady();
          resolve(true);
          return;
        }

        if (elapsed >= maxWaitMs) {
          clearInterval(checkInterval);
          this.persistenceTimedOut = true;
          console.warn(`🔐 TOKEN GATEWAY: Token persistence timeout after ${elapsed}ms - proceeding anyway`);
          // Still mark as ready to avoid blocking - queries may succeed if token appears soon
          this.markTokenReady();
          resolve(false);
        }
      }, POLL_INTERVAL_MS);
    });
  }

  /**
   * Check if token in localStorage matches the expected access token
   */
  isTokenPersisted(accessToken: string): boolean {
    try {
      // Find the Supabase auth storage key
      const authKey = Object.keys(localStorage).find(key =>
        key.startsWith(STORAGE_KEY_PREFIX) && key.includes('auth-token')
      );

      if (!authKey) {
        return false;
      }

      const storedData = localStorage.getItem(authKey);
      if (!storedData) {
        return false;
      }

      const parsed = JSON.parse(storedData);
      // Check if the stored token matches the session token
      return parsed?.access_token === accessToken;
    } catch (error) {
      console.warn('🔐 TOKEN GATEWAY: Error checking token persistence:', error);
      return false;
    }
  }

  /**
   * Mark token as ready and call all pending callbacks
   */
  markTokenReady(): void {
    this.tokenReady = true;

    // Call all pending callbacks
    const callbacks = [...this.pendingCallbacks];
    this.pendingCallbacks = [];

    callbacks.forEach(callback => {
      try {
        callback();
      } catch (error) {
        console.error('🔐 TOKEN GATEWAY: Error in callback:', error);
      }
    });
  }

  /**
   * Register a callback for when token becomes ready
   * Returns cleanup function to unregister
   */
  onTokenReady(callback: () => void): () => void {
    if (this.tokenReady) {
      // Already ready, call immediately
      callback();
      return () => {};
    }

    this.pendingCallbacks.push(callback);

    return () => {
      const index = this.pendingCallbacks.indexOf(callback);
      if (index > -1) {
        this.pendingCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Check if token is marked as ready
   */
  isReady(): boolean {
    return this.tokenReady;
  }

  /**
   * Reset state (useful for sign out or testing)
   */
  reset(): void {
    this.tokenReady = false;
    this.sessionVerified = false;
    this.pendingCallbacks = [];
    this.persistenceTimedOut = false;
  }
}

export const tokenPersistenceGateway = TokenPersistenceGatewayService.getInstance();
export default TokenPersistenceGatewayService;
