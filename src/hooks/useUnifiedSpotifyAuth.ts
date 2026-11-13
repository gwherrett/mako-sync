import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { SpotifyAuthManager, type SpotifyAuthState, type SpotifyOperationResult } from '@/services/spotifyAuthManager.service';
import type { SpotifyConnection } from '@/types/spotify';
import { errorFields } from '@/utils/errorUtils';
import { useAuth } from '@/contexts/NewAuthContext';

/**
 * Unified Spotify Authentication Hook
 *
 * Console log prefixes:
 *   🎵 SPOTIFY: Spotify auth flow
 */

export interface UseUnifiedSpotifyAuthConfig {
  autoRefresh?: boolean;
  healthMonitoring?: boolean;
  securityValidation?: boolean;
  onConnectionChange?: (isConnected: boolean, connection: SpotifyConnection | null) => void;
  onError?: (error: string) => void;
}

export interface UseUnifiedSpotifyAuthReturn {
  // Connection state
  isConnected: boolean;
  isLoading: boolean;
  isInitialCheckComplete: boolean; // True after initial connection check finishes (success or failure)
  connection: SpotifyConnection | null;
  error: string | null;
  healthStatus: 'healthy' | 'warning' | 'error' | 'unknown';

  // Operation states
  isConnecting: boolean;
  isDisconnecting: boolean;
  isSyncing: boolean;
  isRefreshing: boolean;

  // Actions
  connectSpotify: () => Promise<boolean>;
  disconnectSpotify: () => Promise<boolean>;
  refreshTokens: () => Promise<boolean>;
  syncLikedSongs: (forceFullSync?: boolean) => Promise<boolean>;
  checkConnection: (force?: boolean) => Promise<boolean>;
  performHealthCheck: () => Promise<boolean>;
  validateSecurity: () => Promise<boolean>;

  // Utilities
  clearError: () => void;
  retryLastOperation: () => Promise<boolean>;
}

type SpotifyOperation =
  | { type: 'connect' }
  | { type: 'disconnect' }
  | { type: 'refresh' }
  | { type: 'sync'; forceFullSync: boolean };

export const useUnifiedSpotifyAuth = (config: UseUnifiedSpotifyAuthConfig = {}): UseUnifiedSpotifyAuthReturn => {
  const {
    autoRefresh = true,
    healthMonitoring = true,
    securityValidation = true,
    onConnectionChange,
    onError
  } = config;

  // Get auth context to wait for initialization
  const { loading: authLoading, initialDataReady, isAuthenticated, spotifyDataFetchEnabled } = useAuth();

  // Get SpotifyAuthManager instance (a singleton, so this is the same object on every render)
  const [authManager] = useState<SpotifyAuthManager>(() =>
    SpotifyAuthManager.getInstance({
      autoRefresh,
      healthMonitoring,
      securityValidation,
    })
  );

  // Local state
  const [authState, setAuthState] = useState<SpotifyAuthState>(() => authManager.getState());

  // Track if initial check has been done to prevent multiple checks
  const initialCheckDone = useRef(false);
  // Track previous spotifyDataFetchEnabled to detect false → true transition
  const prevDataFetchEnabled = useRef(spotifyDataFetchEnabled);
  const [isInitialCheckComplete, setIsInitialCheckComplete] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // The last operation started, so retryLastOperation can run it again
  const [lastOperation, setLastOperation] = useState<SpotifyOperation | null>(null);

  const { toast } = useToast();

  // Subscribe to auth manager state changes
  useEffect(() => {
    const unsubscribe = authManager.subscribe((newState) => {
      // Only update if state has actually changed (shallow comparison)
      setAuthState((prevState) => {
        if (
          prevState.isConnected === newState.isConnected &&
          prevState.isLoading === newState.isLoading &&
          prevState.error === newState.error &&
          prevState.healthStatus === newState.healthStatus &&
          prevState.connection?.id === newState.connection?.id
        ) {
          return prevState; // No change, prevent re-render
        }
        return newState;
      });

      // Notify connection change callback
      if (onConnectionChange) {
        onConnectionChange(newState.isConnected, newState.connection);
      }

      // Notify error callback
      if (onError && newState.error) {
        onError(newState.error);
      }
    });

    return unsubscribe;
  }, [authManager, onConnectionChange, onError]);

  // Not signed in: there's nothing to check, so the initial check is complete once auth is ready
  if (!isInitialCheckComplete && !authLoading && initialDataReady && !isAuthenticated) {
    setIsInitialCheckComplete(true);
  }

  // Defer Spotify connection check until auth is fully complete
  useEffect(() => {
    // Don't check until auth initialization is complete
    if (authLoading || !initialDataReady) {
      return;
    }

    // Not signed in: marked complete during render, above
    if (!isAuthenticated) {
      return;
    }

    // Only check connection if we don't have recent data (avoid redundant checks)
    const currentState = authManager.getState();
    const timeSinceLastCheck = Date.now() - currentState.lastCheck;
    const shouldCheck = timeSinceLastCheck > 30000; // 30 seconds

    if (shouldCheck && !initialCheckDone.current) {
      initialCheckDone.current = true;
      console.log('🎵 SPOTIFY: Checking connection...');
      // Perform the check and mark complete when done
      authManager.checkConnection().finally(() => {
        const state = authManager.getState();
        console.log('🎵 SPOTIFY: ✓ Ready', state.isConnected ? '(connected)' : '(not connected)');
        setIsInitialCheckComplete(true);
      });
    } else {
      // Mark as complete since we're using cached data
      const state = authManager.getState();
      console.log('🎵 SPOTIFY: ✓ Ready (cached)', state.isConnected ? '(connected)' : '(not connected)');
      setIsInitialCheckComplete(true);
    }
  }, [authManager, authLoading, initialDataReady, isAuthenticated]);

  // Re-check connection when spotifyDataFetchEnabled transitions false → true (token refresh settle)
  useEffect(() => {
    if (prevDataFetchEnabled.current === false && spotifyDataFetchEnabled === true && isAuthenticated) {
      console.log('🎵 SPOTIFY: spotifyDataFetchEnabled restored, re-checking connection...');
      authManager.checkConnection(true).then(() => {
        const state = authManager.getState();
        console.log('🎵 SPOTIFY: ✓ Re-check complete', state.isConnected ? '(connected)' : '(not connected)');
      });
    }
    prevDataFetchEnabled.current = spotifyDataFetchEnabled;
  }, [authManager, spotifyDataFetchEnabled, isAuthenticated]);

  // Clear error function
  const clearError = useCallback(() => {
    // The auth manager doesn't expose a clearError method directly,
    // but errors are typically cleared on successful operations
  }, []);

  // Connect to Spotify
  const connectSpotify = useCallback(async (): Promise<boolean> => {
    if (isConnecting) return false;

    setIsConnecting(true);
    setLastOperation({ type: 'connect' });

    try {
      console.log('🎵 SPOTIFY: Connecting...');
      const result = await authManager.connectSpotify();

      if (result.success) {
        toast({
          title: "Connecting to Spotify",
          description: "Redirecting to Spotify for authorization...",
        });
        return true;
      } else {
        console.log('🎵 SPOTIFY: ✗ Connection failed:', result.error);
        toast({
          title: "Connection Failed",
          description: result.error || "Failed to connect to Spotify",
          variant: "destructive",
        });
        return false;
      }
    } catch (error: unknown) {
      console.log('🎵 SPOTIFY: ✗ Connection error:', errorFields(error).message);
      toast({
        title: "Connection Error",
        description: errorFields(error).message || "An unexpected error occurred",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsConnecting(false);
    }
  }, [authManager, isConnecting, toast]);

  // Disconnect from Spotify
  const disconnectSpotify = useCallback(async (): Promise<boolean> => {
    if (isDisconnecting) return false;

    setIsDisconnecting(true);
    setLastOperation({ type: 'disconnect' });

    try {
      console.log('🎵 SPOTIFY: Disconnecting...');
      const result = await authManager.disconnectSpotify();

      if (result.success) {
        console.log('🎵 SPOTIFY: ✓ Disconnected');
        toast({
          title: "Spotify Disconnected",
          description: "Successfully disconnected from Spotify",
        });
        return true;
      } else {
        console.log('🎵 SPOTIFY: ✗ Disconnect failed:', result.error);
        toast({
          title: "Disconnect Failed",
          description: result.error || "Failed to disconnect from Spotify",
          variant: "destructive",
        });
        return false;
      }
    } catch (error: unknown) {
      console.log('🎵 SPOTIFY: ✗ Disconnect error:', errorFields(error).message);
      toast({
        title: "Disconnect Error",
        description: errorFields(error).message || "An unexpected error occurred",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsDisconnecting(false);
    }
  }, [authManager, isDisconnecting, toast]);

  // Refresh tokens
  const refreshTokens = useCallback(async (): Promise<boolean> => {
    if (isRefreshing) return false;

    setIsRefreshing(true);
    setLastOperation({ type: 'refresh' });

    try {
      const result = await authManager.refreshTokens();

      if (result.success) {
        toast({
          title: "Tokens Refreshed",
          description: "Spotify tokens have been refreshed successfully",
        });
        return true;
      } else {
        toast({
          title: "Refresh Failed",
          description: result.error || "Failed to refresh tokens",
          variant: "destructive",
        });
        return false;
      }
    } catch (error: unknown) {
      toast({
        title: "Refresh Error",
        description: errorFields(error).message || "An unexpected error occurred",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsRefreshing(false);
    }
  }, [authManager, isRefreshing, toast]);

  // Sync liked songs
  const syncLikedSongs = useCallback(async (forceFullSync: boolean = false): Promise<boolean> => {
    if (isSyncing) return false;

    setIsSyncing(true);
    setLastOperation({ type: 'sync', forceFullSync });

    try {
      const result = await authManager.syncLikedSongs(forceFullSync);

      if (result.success) {
        if (result.data?.genre_health_warning) {
          toast({
            title: "Genre data warning",
            description: result.data.genre_health_warning,
            variant: "destructive",
          });
        }
        const syncType = forceFullSync ? 'Full' : 'Incremental';
        toast({
          title: "Sync Complete",
          description: `${syncType} sync completed successfully`,
        });
        return true;
      } else {
        toast({
          title: "Sync Failed",
          description: result.error || "Failed to sync liked songs",
          variant: "destructive",
        });
        return false;
      }
    } catch (error: unknown) {
      toast({
        title: "Sync Error",
        description: errorFields(error).message || "An unexpected error occurred",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsSyncing(false);
    }
  }, [authManager, isSyncing, toast]);

  // Check connection
  const checkConnection = useCallback(async (force: boolean = false): Promise<boolean> => {
    try {
      const result = await authManager.checkConnection(force);
      return result.success;
    } catch (error: unknown) {
      console.error('🎵 SPOTIFY: Connection check failed:', errorFields(error).message);
      return false;
    }
  }, [authManager]);

  // Perform health check
  const performHealthCheck = useCallback(async (): Promise<boolean> => {
    try {
      const result = await authManager.performHealthCheck();

      if (result.success) {
        toast({
          title: "Health Check Passed",
          description: "Spotify connection is healthy",
        });
        return true;
      } else {
        toast({
          title: "Health Check Failed",
          description: result.error || "Health check failed",
          variant: "destructive",
        });
        return false;
      }
    } catch (error: unknown) {
      toast({
        title: "Health Check Error",
        description: errorFields(error).message || "An unexpected error occurred",
        variant: "destructive",
      });
      return false;
    }
  }, [authManager, toast]);

  // Validate security
  const validateSecurity = useCallback(async (): Promise<boolean> => {
    try {
      const result = await authManager.validateSecurity();

      if (result.success) {
        toast({
          title: "Security Validation Passed",
          description: "No security issues detected",
        });
        return true;
      } else {
        toast({
          title: "Security Issues Detected",
          description: result.error || "Security validation failed",
          variant: "destructive",
        });
        return false;
      }
    } catch (error: unknown) {
      toast({
        title: "Security Validation Error",
        description: errorFields(error).message || "An unexpected error occurred",
        variant: "destructive",
      });
      return false;
    }
  }, [authManager, toast]);

  // Retry last operation
  const retryLastOperation = useCallback(async (): Promise<boolean> => {
    if (!lastOperation) {
      toast({
        title: "No Operation to Retry",
        description: "No previous operation available for retry",
        variant: "destructive",
      });
      return false;
    }

    try {
      switch (lastOperation.type) {
        case 'connect':
          return await connectSpotify();
        case 'disconnect':
          return await disconnectSpotify();
        case 'refresh':
          return await refreshTokens();
        case 'sync':
          return await syncLikedSongs(lastOperation.forceFullSync);
      }
    } catch (error: unknown) {
      toast({
        title: "Retry Failed",
        description: errorFields(error).message || "Failed to retry operation",
        variant: "destructive",
      });
      return false;
    }
  }, [lastOperation, connectSpotify, disconnectSpotify, refreshTokens, syncLikedSongs, toast]);

  return {
    // Connection state
    isConnected: authState.isConnected,
    isLoading: authState.isLoading,
    isInitialCheckComplete,
    connection: authState.connection,
    error: authState.error,
    healthStatus: authState.healthStatus,

    // Operation states
    isConnecting,
    isDisconnecting,
    isSyncing,
    isRefreshing,

    // Actions
    connectSpotify,
    disconnectSpotify,
    refreshTokens,
    syncLikedSongs,
    checkConnection,
    performHealthCheck,
    validateSecurity,

    // Utilities
    clearError,
    retryLastOperation,
  };
};

export default useUnifiedSpotifyAuth;
