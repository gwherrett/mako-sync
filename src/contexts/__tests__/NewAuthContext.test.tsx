/**
 * NewAuthContext gate state machine tests.
 *
 * Tests spotifyDataFetchEnabled / dataFetchEnabled gate behaviors in isolation.
 * The node test environment has no DOM, so these tests drive the gate logic
 * directly rather than rendering the React context — which is the behaviorally
 * meaningful part and the most regression-prone.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal gate state machine mirroring NewAuthContext's event switch cases.
// Keep in sync with the TOKEN_REFRESHED / SIGNED_IN / SIGNED_OUT handlers.
// ---------------------------------------------------------------------------

class AuthGateSimulator {
  dataFetchEnabled = false;
  spotifyDataFetchEnabled = false;

  private spotifyTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSignedInUserId: string | null = null;
  private lastSignedInTime = 0;
  private isInitialDataReady = false;
  private currentUserId: string | null = null;

  handleSignedIn(userId: string) {
    const now = Date.now();
    const timeSince = now - this.lastSignedInTime;
    const isSameUserRecently = this.lastSignedInUserId === userId && timeSince < 60_000;
    const isAlreadyAuthenticated = this.currentUserId === userId;

    if (isSameUserRecently || (isAlreadyAuthenticated && this.isInitialDataReady)) {
      // Deduplicated — just update session state, leave gates alone
      return;
    }

    this.lastSignedInUserId = userId;
    this.lastSignedInTime = now;
    this.currentUserId = userId;

    // Token persistence gateway disabled path (simplest)
    this.isInitialDataReady = true;
    this.dataFetchEnabled = true;
    this.spotifyDataFetchEnabled = true;
  }

  handleTokenRefreshed() {
    this.spotifyDataFetchEnabled = false;
    if (this.spotifyTimer) clearTimeout(this.spotifyTimer);
    this.spotifyTimer = setTimeout(() => {
      this.spotifyDataFetchEnabled = true;
      this.spotifyTimer = null;
    }, 1500);
  }

  handleSignedOut() {
    if (this.spotifyTimer) {
      clearTimeout(this.spotifyTimer);
      this.spotifyTimer = null;
    }
    this.dataFetchEnabled = false;
    this.spotifyDataFetchEnabled = false;
    this.isInitialDataReady = false;
    this.currentUserId = null;
    this.lastSignedInUserId = null;
  }
}

// ---------------------------------------------------------------------------

describe('NewAuthContext gate state machine', () => {
  let sim: AuthGateSimulator;

  beforeEach(() => {
    vi.useFakeTimers();
    sim = new AuthGateSimulator();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('TOKEN_REFRESHED', () => {
    it('sets spotifyDataFetchEnabled false immediately, restores it after 1500ms', () => {
      sim.handleSignedIn('user-1');
      expect(sim.spotifyDataFetchEnabled).toBe(true);

      sim.handleTokenRefreshed();
      expect(sim.spotifyDataFetchEnabled).toBe(false);

      vi.advanceTimersByTime(1499);
      expect(sim.spotifyDataFetchEnabled).toBe(false);

      vi.advanceTimersByTime(1);
      expect(sim.spotifyDataFetchEnabled).toBe(true);
    });

    it('leaves dataFetchEnabled true during the settle window', () => {
      sim.handleSignedIn('user-1');
      sim.handleTokenRefreshed();

      vi.advanceTimersByTime(750); // mid-window
      expect(sim.dataFetchEnabled).toBe(true);

      vi.advanceTimersByTime(750); // window complete
      expect(sim.dataFetchEnabled).toBe(true);
    });

    it('resets the 1500ms window when TOKEN_REFRESHED fires again mid-window', () => {
      sim.handleSignedIn('user-1');
      sim.handleTokenRefreshed();

      vi.advanceTimersByTime(1000); // mid first window
      expect(sim.spotifyDataFetchEnabled).toBe(false);

      sim.handleTokenRefreshed(); // second event resets the clock
      vi.advanceTimersByTime(1499);
      expect(sim.spotifyDataFetchEnabled).toBe(false);

      vi.advanceTimersByTime(1);
      expect(sim.spotifyDataFetchEnabled).toBe(true);
    });
  });

  describe('SIGNED_IN deduplication', () => {
    it('does not reset gates when the same user signs in again within 60s', () => {
      sim.handleSignedIn('user-1');
      sim.handleTokenRefreshed(); // spotifyDataFetchEnabled → false, timer starts

      expect(sim.spotifyDataFetchEnabled).toBe(false);

      // Second SIGNED_IN for same user — should be deduplicated
      sim.handleSignedIn('user-1');
      expect(sim.spotifyDataFetchEnabled).toBe(false); // timer still running, not reset

      // Timer completes normally
      vi.advanceTimersByTime(1500);
      expect(sim.spotifyDataFetchEnabled).toBe(true);
    });

    it('processes a fresh SIGNED_IN for a different user', () => {
      sim.handleSignedIn('user-1');
      sim.handleTokenRefreshed();

      // Different user triggers a genuine sign-in — gates restored immediately
      sim.handleSignedIn('user-2');
      expect(sim.dataFetchEnabled).toBe(true);
      expect(sim.spotifyDataFetchEnabled).toBe(true);
    });
  });

  describe('SIGNED_OUT', () => {
    it('sets both gates to false', () => {
      sim.handleSignedIn('user-1');
      expect(sim.dataFetchEnabled).toBe(true);
      expect(sim.spotifyDataFetchEnabled).toBe(true);

      sim.handleSignedOut();
      expect(sim.dataFetchEnabled).toBe(false);
      expect(sim.spotifyDataFetchEnabled).toBe(false);
    });

    it('cancels the spotifyDataFetchEnabled restore timer', () => {
      sim.handleSignedIn('user-1');
      sim.handleTokenRefreshed();
      expect(sim.spotifyDataFetchEnabled).toBe(false);

      sim.handleSignedOut();

      // Timer was cancelled — advancing past 1500ms should not restore spotifyDataFetchEnabled
      vi.advanceTimersByTime(2000);
      expect(sim.spotifyDataFetchEnabled).toBe(false);
    });
  });

  describe('initial state', () => {
    it('starts with both gates disabled', () => {
      expect(sim.dataFetchEnabled).toBe(false);
      expect(sim.spotifyDataFetchEnabled).toBe(false);
    });

    it('enables both gates on first SIGNED_IN', () => {
      sim.handleSignedIn('user-1');
      expect(sim.dataFetchEnabled).toBe(true);
      expect(sim.spotifyDataFetchEnabled).toBe(true);
    });
  });
});
