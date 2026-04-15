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

  const manager = useRef<DiscogsAuthManager>(DiscogsAuthManager.getInstance());
  const [authState, setAuthState] = useState<DiscogsAuthState>(() => manager.current.getState());
  const [isInitialCheckComplete, setIsInitialCheckComplete] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const initialCheckDone = useRef(false);

  useEffect(() => {
    return manager.current.subscribe((newState) => {
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
  }, []);

  useEffect(() => {
    if (authLoading || !initialDataReady) return;

    if (!isAuthenticated) {
      setIsInitialCheckComplete(true);
      return;
    }

    const timeSinceLastCheck = Date.now() - manager.current.getState().lastCheck;
    if (timeSinceLastCheck > 30000 && !initialCheckDone.current) {
      initialCheckDone.current = true;
      console.log('🎵 DISCOGS: Checking connection...');
      manager.current.checkConnection().finally(() => {
        const state = manager.current.getState();
        console.log('🎵 DISCOGS: Ready', state.isConnected ? '(connected)' : '(not connected)');
        setIsInitialCheckComplete(true);
      });
    } else {
      setIsInitialCheckComplete(true);
    }
  }, [authLoading, initialDataReady, isAuthenticated]);

  const connectDiscogs = useCallback(async (): Promise<boolean> => {
    if (isConnecting) return false;
    setIsConnecting(true);
    try {
      const callbackUrl = `${window.location.origin}/discogs-callback`;
      const result = await manager.current.connect(callbackUrl);
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
  }, [isConnecting, toast]);

  const disconnectDiscogs = useCallback(async (): Promise<boolean> => {
    if (isDisconnecting) return false;
    setIsDisconnecting(true);
    try {
      const result = await manager.current.disconnect();
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
  }, [isDisconnecting, toast]);

  const checkConnection = useCallback(async (force = false): Promise<boolean> => {
    const result = await manager.current.checkConnection(force);
    return result.success;
  }, []);

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
