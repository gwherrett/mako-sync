import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/utils/logger';

/**
 * Hook to proactively refresh SUPABASE AUTH tokens when the tab becomes visible
 * after being hidden. This helps prevent stale token issues when users
 * return to the app after an idle period.
 *
 * NOTE: This refreshes SUPABASE auth tokens, NOT Spotify API tokens.
 * Spotify tokens are refreshed separately via edge functions.
 */

// Token is considered "expiring soon" if it expires within this time
const EXPIRY_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const VISIBILITY_COOLDOWN_MS = 30000; // 30 seconds minimum hidden time

/**
 * Check if a session's token is expiring soon
 */
function isTokenExpiringSoon(session: { expires_at?: number }): { expiringSoon: boolean; timeUntilExpiry: number } {
  if (!session.expires_at) {
    return { expiringSoon: false, timeUntilExpiry: -1 };
  }

  const expiresAtMs = session.expires_at * 1000;
  const now = Date.now();
  const timeUntilExpiry = expiresAtMs - now;

  return {
    expiringSoon: timeUntilExpiry < EXPIRY_THRESHOLD_MS,
    timeUntilExpiry
  };
}

/**
 * Hook that listens for tab visibility changes and refreshes the SUPABASE auth token
 * when the tab becomes visible if the token is expiring soon.
 */
export function useVisibilityTokenRefresh(): void {
  useEffect(() => {
    let lastVisibilityChange = Date.now();

    const handleVisibilityChange = async () => {
      if (document.visibilityState !== 'visible') {
        return;
      }

      const timeSinceLastChange = Date.now() - lastVisibilityChange;
      lastVisibilityChange = Date.now();

      // Only check if tab was hidden for at least 30 seconds
      // This prevents unnecessary refreshes for quick tab switches
      if (timeSinceLastChange < VISIBILITY_COOLDOWN_MS) {
        return;
      }

      logger.auth('Tab visible after idle', {
        hiddenForSeconds: Math.round(timeSinceLastChange / 1000)
      });

      try {
        const { data, error } = await supabase.auth.getSession();

        if (error) {
          logger.auth('Visibility check: error getting session', { error: error.message }, 'warn');
          return;
        }

        if (!data.session) {
          logger.auth('Visibility check: no session to refresh');
          return;
        }

        const { expiringSoon, timeUntilExpiry } = isTokenExpiringSoon(data.session);
        const minutesUntilExpiry = Math.round(timeUntilExpiry / 60000);

        if (expiringSoon) {
          logger.auth('SUPABASE token expiring soon, waiting for internal refresh', {
            expiresAt: data.session.expires_at
              ? new Date(data.session.expires_at * 1000).toISOString()
              : 'unknown',
            minutesUntilExpiry,
            tokenType: 'SUPABASE_AUTH'
          });

          // IMPORTANT: Supabase's internal _onVisibilityChanged → _recoverAndRefresh fires
          // simultaneously and uses the same rotating refresh token. With noOpLock in client.ts,
          // there is no serialization between this call and the internal refresh — both would
          // compete for the same refresh token, and the loser gets "Invalid Refresh Token".
          // Wait 1.5s for the internal handler to complete first, then re-check before acting.
          await new Promise(resolve => setTimeout(resolve, 1500));

          const { data: refreshedData } = await supabase.auth.getSession();
          if (!refreshedData.session) return;

          const { expiringSoon: stillExpiringSoon } = isTokenExpiringSoon(refreshedData.session);
          if (!stillExpiringSoon) {
            logger.auth('SUPABASE token already refreshed by internal handler, skipping manual refresh', {
              tokenType: 'SUPABASE_AUTH'
            });
            return;
          }

          // Token is still expiring soon after Supabase's own refresh — force our own
          const { error: refreshError } = await supabase.auth.refreshSession();

          if (refreshError) {
            logger.auth('SUPABASE token refresh failed', { error: refreshError.message }, 'warn');
          } else {
            logger.auth('SUPABASE token refreshed successfully', { tokenType: 'SUPABASE_AUTH' });
          }
        } else {
          logger.auth('SUPABASE token still valid', {
            minutesUntilExpiry,
            tokenType: 'SUPABASE_AUTH'
          });
        }
      } catch (error) {
        logger.auth('Visibility handler error', { error }, 'warn');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);
}

export default useVisibilityTokenRefresh;
