import { supabase } from '@/integrations/supabase/client';
import { withTimeout } from '@/utils/promiseUtils';
import type { DiscogsConnection } from '@/types/discogs';

/**
 * Discogs Authentication Manager
 *
 * Mirrors SpotifyAuthManager structure. Manages OAuth 1.0a connection state.
 * Console log prefix: 🎵 DISCOGS:
 */

export interface DiscogsAuthState {
  isConnected: boolean;
  isLoading: boolean;
  connection: DiscogsConnection | null;
  error: string | null;
  lastCheck: number;
}

export interface DiscogsOperationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export class DiscogsAuthManager {
  private static instance: DiscogsAuthManager | null = null;
  private state: DiscogsAuthState;
  private listeners: Set<(state: DiscogsAuthState) => void> = new Set();
  private checkPromise: Promise<DiscogsOperationResult> | null = null;

  private static readonly CHECK_COOLDOWN = 5000;

  private constructor() {
    this.state = {
      isConnected: false,
      isLoading: false,
      connection: null,
      error: null,
      lastCheck: 0,
    };
  }

  static getInstance(): DiscogsAuthManager {
    if (!DiscogsAuthManager.instance) {
      DiscogsAuthManager.instance = new DiscogsAuthManager();
    }
    return DiscogsAuthManager.instance;
  }

  getState(): DiscogsAuthState {
    return { ...this.state };
  }

  subscribe(listener: (state: DiscogsAuthState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(partial: Partial<DiscogsAuthState>) {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach(l => l(this.state));
  }

  async checkConnection(force = false): Promise<DiscogsOperationResult> {
    const timeSinceLastCheck = Date.now() - this.state.lastCheck;
    if (!force && timeSinceLastCheck < DiscogsAuthManager.CHECK_COOLDOWN && this.state.lastCheck > 0) {
      return { success: this.state.isConnected };
    }

    if (this.checkPromise) return this.checkPromise;

    this.checkPromise = (async () => {
      this.setState({ isLoading: true, error: null });
      try {
        const { data, error } = await withTimeout(
          supabase
            .from('discogs_connections')
            .select('*')
            .maybeSingle()
            .then(r => r),
          15000,
          'Discogs connection check timed out'
        );

        if (error) throw new Error(error.message);

        this.setState({
          isConnected: !!data,
          connection: data as DiscogsConnection | null,
          isLoading: false,
          lastCheck: Date.now(),
        });
        return { success: true };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('🎵 DISCOGS: Connection check failed:', msg);
        this.setState({ isLoading: false, error: msg, lastCheck: Date.now() });
        return { success: false, error: msg };
      } finally {
        this.checkPromise = null;
      }
    })();

    return this.checkPromise;
  }

  async connect(callbackUrl: string): Promise<DiscogsOperationResult<{ authorizeUrl: string }>> {
    this.setState({ isLoading: true, error: null });
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('Not authenticated');

      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
      const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ||
        import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) as string;

      const response = await fetch(`${SUPABASE_URL}/functions/v1/discogs-auth`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ action: 'request_token', callback_url: callbackUrl }),
      });

      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Failed to get request token');

      // Store the request token secret in sessionStorage for the callback
      sessionStorage.setItem('discogs_oauth_token_secret', json.oauth_token_secret);
      sessionStorage.setItem('discogs_oauth_token', json.oauth_token);

      this.setState({ isLoading: false });
      return { success: true, data: { authorizeUrl: json.authorize_url } };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setState({ isLoading: false, error: msg });
      return { success: false, error: msg };
    }
  }

  async exchangeAccessToken(
    oauthToken: string,
    oauthVerifier: string,
    oauthTokenSecret: string
  ): Promise<DiscogsOperationResult> {
    this.setState({ isLoading: true, error: null });
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('Not authenticated');

      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
      const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ||
        import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) as string;

      const response = await fetch(`${SUPABASE_URL}/functions/v1/discogs-auth`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          action: 'access_token',
          oauth_token: oauthToken,
          oauth_verifier: oauthVerifier,
          oauth_token_secret: oauthTokenSecret,
        }),
      });

      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Failed to exchange access token');

      // Clear sessionStorage
      sessionStorage.removeItem('discogs_oauth_token_secret');
      sessionStorage.removeItem('discogs_oauth_token');

      // Refresh connection state
      await this.checkConnection(true);
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setState({ isLoading: false, error: msg });
      return { success: false, error: msg };
    }
  }

  async disconnect(): Promise<DiscogsOperationResult> {
    this.setState({ isLoading: true, error: null });
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('Not authenticated');

      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
      const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ||
        import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) as string;

      const response = await fetch(`${SUPABASE_URL}/functions/v1/discogs-auth`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ action: 'disconnect' }),
      });

      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Failed to disconnect');

      this.setState({
        isConnected: false,
        connection: null,
        isLoading: false,
        lastCheck: Date.now(),
      });
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setState({ isLoading: false, error: msg });
      return { success: false, error: msg };
    }
  }
}
