import { supabase } from '@/integrations/supabase/client';
import { sessionCache } from '@/services/sessionCache.service';
import { logger } from '@/utils/logger';
import type { SpotifyConnection } from '@/types/spotify';

/**
 * Unified Spotify Authentication Manager
 *
 * Consolidates all Spotify authentication operations into a single service.
 */

export interface SpotifyAuthState {
  isConnected: boolean;
  isLoading: boolean;
  connection: SpotifyConnection | null;
  error: string | null;
  lastCheck: number;
  healthStatus: 'healthy' | 'warning' | 'error' | 'unknown';
}

export interface SpotifyAuthConfig {
  autoRefresh: boolean;
  healthMonitoring: boolean;
  securityValidation: boolean;
  retryConfig: {
    maxRetries: number;
    retryDelay: number;
  };
}

/** Returns true if the stored Spotify connection includes the given OAuth scope. */
export function hasSpotifyScope(connection: SpotifyConnection | null, scope: string): boolean {
  return !!connection?.scope?.split(' ').includes(scope);
}

export interface SpotifyOperationResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: {
    attempts?: number;
    duration?: number;
    cached?: boolean;
  };
}

export class SpotifyAuthManager {
  private static instance: SpotifyAuthManager | null = null;
  private state: SpotifyAuthState;
  private config: SpotifyAuthConfig;
  private listeners: Set<(state: SpotifyAuthState) => void> = new Set();
  private healthMonitor: any = null;
  private checkPromise: Promise<SpotifyOperationResult> | null = null;

  private syncInProgress: boolean = false;
  private syncPromise: Promise<SpotifyOperationResult> | null = null;

  private static readonly CONNECTION_CHECK_COOLDOWN = 5000;

  private constructor(config: Partial<SpotifyAuthConfig> = {}) {
    this.config = {
      autoRefresh: true,
      healthMonitoring: true,
      securityValidation: true,
      retryConfig: {
        maxRetries: 3,
        retryDelay: 1000,
      },
      ...config,
    };

    this.state = {
      isConnected: false,
      isLoading: false,
      connection: null,
      error: null,
      lastCheck: 0,
      healthStatus: 'unknown',
    };

    if (this.config.healthMonitoring) {
      this.initializeHealthMonitoring();
    }
  }

  static getInstance(config?: Partial<SpotifyAuthConfig>): SpotifyAuthManager {
    if (!this.instance) {
      this.instance = new SpotifyAuthManager(config);
    }
    return this.instance;
  }

  subscribe(listener: (state: SpotifyAuthState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): SpotifyAuthState {
    return { ...this.state };
  }

  async checkConnection(force: boolean = false): Promise<SpotifyOperationResult<SpotifyConnection>> {
    const now = Date.now();

    if (!force && (now - this.state.lastCheck) < SpotifyAuthManager.CONNECTION_CHECK_COOLDOWN) {
      logger.spotify('Using cached connection status');
      return {
        success: this.state.isConnected,
        data: this.state.connection,
        error: this.state.error,
        metadata: { cached: true }
      };
    }

    if (this.checkPromise && !force) {
      logger.spotify('Returning existing check promise');
      return this.checkPromise;
    }

    logger.spotify('Starting connection check');

    this.checkPromise = this.performConnectionCheck();
    const result = await this.checkPromise;
    this.checkPromise = null;

    return result;
  }

  private async performConnectionCheck(): Promise<SpotifyOperationResult<SpotifyConnection>> {
    const startTime = Date.now();

    this.updateState({
      isLoading: true,
      error: null,
      lastCheck: startTime,
    });

    try {
      logger.spotify('Starting session fetch via cache');
      const sessionStartTime = Date.now();

      const { session, error: sessionError } = await sessionCache.getSession(false, 'spotify-auth');

      const sessionElapsed = Date.now() - sessionStartTime;
      logger.spotify(`Session fetch completed in ${sessionElapsed}ms`, {
        hasSession: !!session,
        hasUser: !!session?.user
      });

      if (sessionError || !session?.user) {
        const error = 'User not authenticated';

        logger.spotify('Authentication failure during connection check', {
          hasSession: !!session,
          hasUser: !!session?.user
        }, 'warn');

        this.updateState({
          isConnected: false,
          connection: null,
          error,
          isLoading: false,
          healthStatus: 'error',
        });
        return { success: false, error };
      }

      const user = session.user;

      logger.spotify('Starting connection query');
      const connectionStartTime = Date.now();
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let queryCompleted = false;

      const { data: connection, error: connectionError } = await Promise.race([
        (async () => {
          try {
            const result = await supabase
              .from('spotify_connections')
              .select('*')
              .eq('user_id', user.id)
              .maybeSingle();

            queryCompleted = true;
            if (timeoutId) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }

            const elapsed = Date.now() - connectionStartTime;
            logger.spotify(`Connection query completed in ${elapsed}ms`);
            return result;
          } catch (error) {
            queryCompleted = true;
            if (timeoutId) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }

            const elapsed = Date.now() - connectionStartTime;
            logger.spotify(`Connection query failed after ${elapsed}ms`, { error }, 'error');
            throw error;
          }
        })(),
        new Promise<any>((resolve) => {
          timeoutId = setTimeout(() => {
            if (!queryCompleted) {
              const elapsed = Date.now() - connectionStartTime;
              logger.spotify(`Connection query timeout after ${elapsed}ms`, undefined, 'warn');
              resolve({ data: null, error: { message: 'Connection query timeout' } });
            }
          }, 5000);
        })
      ]);

      if (connectionError) {
        const error = `Database error: ${connectionError.message}`;

        logger.spotify('Database error during connection check', {
          error: connectionError.message
        }, 'error');

        this.updateState({
          isConnected: false,
          connection: null,
          error,
          isLoading: false,
          healthStatus: 'error',
        });
        return { success: false, error };
      }

      const duration = Date.now() - startTime;

      if (connection) {
        let healthStatus: SpotifyAuthState['healthStatus'] = 'healthy';

        if (this.config.securityValidation) {
          try {
            if (!connection.access_token || !connection.refresh_token) {
              healthStatus = 'error';
            }
          } catch (error) {
            logger.spotify('Token health validation failed', { error }, 'warn');
            healthStatus = 'warning';
          }
        }

        this.updateState({
          isConnected: true,
          connection: connection as SpotifyConnection,
          error: null,
          isLoading: false,
          healthStatus,
        });

        logger.spotify('Connection found and validated');
        return {
          success: true,
          data: connection as SpotifyConnection,
          metadata: { duration }
        };
      } else {
        this.updateState({
          isConnected: false,
          connection: null,
          error: null,
          isLoading: false,
          healthStatus: 'unknown',
        });

        logger.spotify('No connection found');
        return {
          success: false,
          error: 'No Spotify connection found',
          metadata: { duration }
        };
      }
    } catch (error: any) {
      const errorMessage = error.message || 'Connection check failed';
      const duration = Date.now() - startTime;

      logger.spotify(`Connection check failed after ${duration}ms`, {
        error: errorMessage
      }, 'error');

      this.updateState({
        isConnected: false,
        connection: null,
        error: errorMessage,
        isLoading: false,
        healthStatus: 'error',
      });

      return {
        success: false,
        error: errorMessage,
        metadata: { duration }
      };
    }
  }

  async connectSpotify(): Promise<SpotifyOperationResult> {
    logger.spotify('Starting connection process');

    try {
      const { session } = await sessionCache.getSession(false, 'spotify-connect');

      if (!session?.user) {
        const error = 'Please log in to connect Spotify';

        logger.spotify('Connection attempt without authentication', {
          hasSession: !!session
        }, 'warn');

        this.updateState({ error });
        return { success: false, error };
      }

      const state = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;

      localStorage.setItem('spotify_auth_state', state);
      sessionStorage.setItem('spotify_auth_state_backup', state);

      const scopes = [
        'user-read-private',
        'user-library-read',
        'user-library-modify',
      ].join(' ');

      const redirectUri = import.meta.env.VITE_SPOTIFY_REDIRECT_URI ||
                         `${window.location.origin}/spotify-callback`;
      const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID;

      if (!clientId) {
        const error = 'Spotify client ID not configured';
        this.updateState({ error });
        return { success: false, error };
      }

      const authUrl = new URL('https://accounts.spotify.com/authorize');
      authUrl.searchParams.append('client_id', clientId);
      authUrl.searchParams.append('response_type', 'code');
      authUrl.searchParams.append('redirect_uri', redirectUri);
      authUrl.searchParams.append('scope', scopes);
      authUrl.searchParams.append('state', state);
      authUrl.searchParams.append('t', Date.now().toString());

      logger.spotify('Redirecting to Spotify authorization');

      window.location.href = authUrl.toString();

      return { success: true };
    } catch (error: any) {
      const errorMessage = `Spotify auth failed: ${error.message}`;
      this.updateState({ error: errorMessage });

      logger.spotify('Connect error', { error: error.message }, 'error');

      return { success: false, error: errorMessage };
    }
  }

  async disconnectSpotify(): Promise<SpotifyOperationResult> {
    logger.spotify('Disconnecting from Spotify');

    try {
      const { session } = await sessionCache.getSession(false, 'spotify-disconnect');

      if (!session?.user) {
        logger.spotify('Disconnect attempt without authentication', undefined, 'warn');
        return { success: false, error: 'No user found' };
      }

      const user = session.user;

      const { error } = await supabase
        .from('spotify_connections')
        .delete()
        .eq('user_id', user.id);

      if (error) {
        throw error;
      }

      localStorage.removeItem('spotify_auth_state');
      sessionStorage.removeItem('spotify_auth_state_backup');

      this.updateState({
        isConnected: false,
        connection: null,
        error: null,
        lastCheck: 0,
        healthStatus: 'unknown',
      });

      logger.spotify('Successfully disconnected');
      return { success: true };
    } catch (error: any) {
      const errorMessage = `Disconnect failed: ${error.message}`;

      logger.spotify('Disconnect error', { error: error.message }, 'error');

      this.updateState({ error: errorMessage });

      return { success: false, error: errorMessage };
    }
  }

  async refreshTokens(): Promise<SpotifyOperationResult> {
    logger.spotify('Refreshing tokens');

    if (!this.state.connection) {
      return { success: false, error: 'No connection available for token refresh' };
    }

    try {
      const { session } = await sessionCache.getSession(false, 'spotify-refresh');
      if (!session) {
        throw new Error('No session available for token refresh');
      }

      const response = await supabase.functions.invoke('spotify-sync-liked', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: {
          refresh_only: true
        }
      });

      const result = {
        success: !response.error,
        error: response.error?.message
      };

      if (result.success) {
        await this.checkConnection(true);
        logger.spotify('Tokens refreshed successfully');
      }

      return result;
    } catch (error: any) {
      const errorMessage = `Token refresh failed: ${error.message}`;

      logger.spotify('Token refresh error', { error: error.message }, 'error');

      this.updateState({ error: errorMessage });

      return { success: false, error: errorMessage };
    }
  }

  async syncLikedSongs(forceFullSync: boolean = false): Promise<SpotifyOperationResult> {
    if (this.syncInProgress) {
      logger.spotify('Sync already in progress, returning existing promise');
      return this.syncPromise || { success: false, error: 'Sync already in progress' };
    }

    logger.spotify('Starting liked songs sync');
    this.syncInProgress = true;

    this.syncPromise = this.performSync(forceFullSync);

    try {
      const result = await this.syncPromise;
      return result;
    } finally {
      this.syncInProgress = false;
      this.syncPromise = null;
    }
  }

  private async performSync(forceFullSync: boolean): Promise<SpotifyOperationResult> {
    try {
      const { session } = await sessionCache.getSession(false, 'spotify-sync');

      if (!session) {
        return { success: false, error: 'Please log in to sync liked songs' };
      }

      const response = await supabase.functions.invoke('spotify-sync-liked', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: {
          force_full_sync: forceFullSync
        }
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      // Partial sync: function hit the 120s time budget, progress saved — resume automatically
      if (response.data?.partial) {
        logger.spotify('Sync paused for resume', { resume_offset: response.data.resume_offset });
        return this.performSync(forceFullSync);
      }

      logger.spotify('Sync completed successfully');
      return {
        success: true,
        data: response.data,
        metadata: {
          duration: Date.now() - Date.now()
        }
      };
    } catch (error: any) {
      const errorMessage = `Sync failed: ${error.message}`;

      logger.spotify('Sync error', { error: error.message }, 'error');

      return { success: false, error: errorMessage };
    }
  }

  async performHealthCheck(): Promise<SpotifyOperationResult> {
    logger.spotify('Performing health check');

    if (!this.state.connection) {
      return { success: false, error: 'No connection available for health check' };
    }

    try {
      const { session } = await sessionCache.getSession(false, 'spotify-health');

      if (!session) {
        return { success: false, error: 'No session available' };
      }

      const response = await supabase.functions.invoke('spotify-sync-liked', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: {
          health_check: true
        }
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      this.updateState({ healthStatus: 'healthy' });

      logger.spotify('Health check passed');
      return { success: true, data: response.data };
    } catch (error: any) {
      this.updateState({ healthStatus: 'error' });

      const errorMessage = `Health check failed: ${error.message}`;
      logger.spotify('Health check error', { error: error.message }, 'error');

      return { success: false, error: errorMessage };
    }
  }

  async validateSecurity(): Promise<SpotifyOperationResult> {
    logger.spotify('Validating security');

    if (!this.state.connection) {
      return { success: false, error: 'No connection available for security validation' };
    }

    try {
      const isValid = !!(this.state.connection?.access_token && this.state.connection?.refresh_token);
      const healthStatus: SpotifyAuthState['healthStatus'] = isValid ? 'healthy' : 'error';

      this.updateState({ healthStatus });

      logger.spotify('Security validation completed');
      return {
        success: isValid,
        data: { isValid },
        error: isValid ? undefined : 'Security issues detected'
      };
    } catch (error: any) {
      this.updateState({ healthStatus: 'error' });

      const errorMessage = `Security validation failed: ${error.message}`;
      logger.spotify('Security validation error', { error: error.message }, 'error');

      return { success: false, error: errorMessage };
    }
  }

  private initializeHealthMonitoring(): void {
    if (this.healthMonitor) {
      return;
    }

    try {
      this.healthMonitor = {
        initialized: true,
        stopMonitoring: () => logger.spotify('Health monitoring stopped')
      };

      logger.spotify('Health monitoring initialized');
    } catch (error) {
      logger.spotify('Failed to initialize health monitoring', { error }, 'warn');
    }
  }

  private updateState(updates: Partial<SpotifyAuthState>): void {
    this.state = { ...this.state, ...updates };

    this.listeners.forEach(listener => {
      try {
        listener(this.state);
      } catch (error) {
        logger.spotify('Error in state listener', { error }, 'error');
      }
    });
  }

  setConnectedOptimistically(spotifyUserId: string, displayName?: string): void {
    logger.spotify('Optimistically setting connected state', {
      spotifyUserId,
      displayName
    });

    this.updateState({
      isConnected: true,
      isLoading: false,
      error: null,
      healthStatus: 'healthy',
      lastCheck: Date.now(),
      connection: {
        spotify_user_id: spotifyUserId,
        display_name: displayName || null,
        user_id: '',
        access_token: '***ENCRYPTED_IN_VAULT***',
        refresh_token: '***ENCRYPTED_IN_VAULT***',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        scope: '',
        token_type: 'Bearer',
      } as SpotifyConnection,
    });
  }

  destroy(): void {
    if (this.healthMonitor) {
      this.healthMonitor.stopMonitoring();
      this.healthMonitor = null;
    }

    this.listeners.clear();
    SpotifyAuthManager.instance = null;
  }
}

export default SpotifyAuthManager;
