import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { DiscogsAuthManager, type DiscogsAuthState } from '@/services/discogsAuthManager.service';
import { useAuth } from '@/contexts/NewAuthContext';

/**
 * Discogs Authentication Hook
 *
 * Mirrors useUnifiedSpotifyAuth structure. Manages Discogs OAuth 1.0a state.
 * Console log prefix: 🎵 DISCOGS:
 */

export interface UseDiscogsAuthReturn {
  isConnected: boolean;
  isLoading: boolean;
  isInitialCheckComplete: boolean;
  connection: DiscogsAuthState['connection'];
  error: string | null;

  isConnecting: boolean;
  isDisconnecting: boolean;

  connectDiscogs: () => Promise<boolean>;
  disconnectDiscogs: () => Promise<boolean>;
  checkConnection: (force?: boolean) => Promise<boolean>;
}

export const useDiscogsAuth = (): UseDiscogsAuthReturn => {
  const { loading: authLoading, initialDataReady, isAuthenticated } = useAuth();
  const { toast } = useToast();

  // A singleton, so this is the same object on every render
  const [manager] = useState<DiscogsAuthManager>(() => DiscogsAuthManager.getInstance());
  const [authState, setAuthState] = useState<DiscogsAuthState>(() => manager.getState());
  const [isInitialCheckComplete, setIsInitialCheckComplete] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const initialCheckDone = useRef(false);

  useEffect(() => {
    return manager.subscribe((newState) => {
      setAuthState(prev => {
        if (
          prev.isConnected === newState.isConnected &&
          prev.isLoading === newState.isLoading &&
          prev.error === newState.error &&
          prev.connection?.id === newState.connection?.id
        ) return prev;
        return newState;
      });
    });
  }, [manager]);

  // Not signed in: there's nothing to check, so the initial check is complete once auth is ready
  if (!isInitialCheckComplete && !authLoading && initialDataReady && !isAuthenticated) {
    setIsInitialCheckComplete(true);
  }

  useEffect(() => {
    if (authLoading || !initialDataReady) return;

    // Not signed in: marked complete during render, above
    if (!isAuthenticated) return;

    const timeSinceLastCheck = Date.now() - manager.getState().lastCheck;
    if (timeSinceLastCheck > 30000 && !initialCheckDone.current) {
      initialCheckDone.current = true;
      console.log('🎵 DISCOGS: Checking connection...');
      manager.checkConnection().finally(() => {
        const state = manager.getState();
        console.log('🎵 DISCOGS: Ready', state.isConnected ? '(connected)' : '(not connected)');
        setIsInitialCheckComplete(true);
      });
    } else {
      setIsInitialCheckComplete(true);
    }
  }, [manager, authLoading, initialDataReady, isAuthenticated]);

  const connectDiscogs = useCallback(async (): Promise<boolean> => {
    if (isConnecting) return false;
    setIsConnecting(true);
    try {
      const callbackUrl = `${window.location.origin}/discogs-callback`;
      const result = await manager.connect(callbackUrl);
      if (result.success && result.data?.authorizeUrl) {
        toast({ title: 'Connecting to Discogs', description: 'Redirecting to Discogs for authorization...' });
        window.location.href = result.data.authorizeUrl;
        return true;
      } else {
        toast({ title: 'Connection Failed', description: result.error || 'Failed to connect to Discogs', variant: 'destructive' });
        return false;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: 'Connection Error', description: msg, variant: 'destructive' });
      return false;
    } finally {
      setIsConnecting(false);
    }
  }, [manager, isConnecting, toast]);

  const disconnectDiscogs = useCallback(async (): Promise<boolean> => {
    if (isDisconnecting) return false;
    setIsDisconnecting(true);
    try {
      const result = await manager.disconnect();
      if (result.success) {
        toast({ title: 'Discogs Disconnected', description: 'Successfully disconnected from Discogs' });
        return true;
      } else {
        toast({ title: 'Disconnect Failed', description: result.error || 'Failed to disconnect', variant: 'destructive' });
        return false;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: 'Disconnect Error', description: msg, variant: 'destructive' });
      return false;
    } finally {
      setIsDisconnecting(false);
    }
  }, [manager, isDisconnecting, toast]);

  const checkConnection = useCallback(async (force = false): Promise<boolean> => {
    const result = await manager.checkConnection(force);
    return result.success;
  }, [manager]);

  return {
    isConnected: authState.isConnected,
    isLoading: authState.isLoading,
    isInitialCheckComplete,
    connection: authState.connection,
    error: authState.error,
    isConnecting,
    isDisconnecting,
    connectDiscogs,
    disconnectDiscogs,
    checkConnection,
  };
};

export default useDiscogsAuth;
