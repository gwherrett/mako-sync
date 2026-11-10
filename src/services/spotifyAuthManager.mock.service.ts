import type { SpotifyConnection } from '@/types/spotify';

/**
 * Mock Spotify Authentication Manager
 * 
 * Provides a complete mock implementation of the Spotify authentication system
 * for testing and development without requiring actual Spotify API access.
 */

export interface SpotifyAuthState {
  isConnected: boolean;
  isLoading: boolean;
  connection: SpotifyConnection | null;
  error: string | null;
  healthStatus: 'healthy' | 'warning' | 'error' | 'unknown';
}

export interface SpotifyOperationResult {
  success: boolean;
  error?: string;
  data?: unknown;
}

type StateSubscriber = (state: SpotifyAuthState) => void;

export class MockSpotifyAuthManager {
  private static instance: MockSpotifyAuthManager | null = null;
  private state: SpotifyAuthState;
  private subscribers: Set<StateSubscriber> = new Set();
  private mockConnection: SpotifyConnection | null = null;

  private constructor() {
    this.state = {
      isConnected: false,
      isLoading: false,
      connection: null,
      error: null,
      healthStatus: 'unknown'
    };

    // Create a mock connection for testing
    this.createMockConnection();
  }

  static getInstance(): MockSpotifyAuthManager {
    if (!MockSpotifyAuthManager.instance) {
      MockSpotifyAuthManager.instance = new MockSpotifyAuthManager();
    }
    return MockSpotifyAuthManager.instance;
  }

  private createMockConnection(): void {
    this.mockConnection = {
      id: 'mock-connection-123',
      user_id: 'mock-user-456',
      spotify_user_id: 'mock-spotify-789',
      access_token: '***ENCRYPTED_IN_VAULT***',
      refresh_token: '***ENCRYPTED_IN_VAULT***',
      access_token_secret_id: 'vault-secret-access-123',
      refresh_token_secret_id: 'vault-secret-refresh-456',
      expires_at: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
      scope: 'user-library-read user-read-private',
      token_type: 'Bearer',
      display_name: 'Mock User',
      email: 'mock@example.com',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  }

  private updateState(updates: Partial<SpotifyAuthState>): void {
    this.state = { ...this.state, ...updates };
    this.notifySubscribers();
  }

  private notifySubscribers(): void {
    this.subscribers.forEach(subscriber => subscriber(this.state));
  }

  subscribe(callback: StateSubscriber): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  getState(): SpotifyAuthState {
    return { ...this.state };
  }

  async checkConnection(force: boolean = false): Promise<SpotifyOperationResult> {
    console.log('🔍 MOCK: Checking Spotify connection...', { force });
    
    this.updateState({ isLoading: true, error: null });

    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 500));

    // Mock connection check logic
    const isConnected = Math.random() > 0.3; // 70% chance of being connected
    
    if (isConnected && this.mockConnection) {
      this.updateState({
        isConnected: true,
        isLoading: false,
        connection: this.mockConnection,
        healthStatus: 'healthy'
      });
      
      console.log('✅ MOCK: Connection check successful');
      return { success: true, data: { connection: this.mockConnection } };
    } else {
      this.updateState({
        isConnected: false,
        isLoading: false,
        connection: null,
        healthStatus: 'error'
      });
      
      console.log('❌ MOCK: No connection found');
      return { success: false, error: 'No Spotify connection found' };
    }
  }

  async connectSpotify(): Promise<SpotifyOperationResult> {
    console.log('🔵 MOCK: Starting Spotify connection...');
    
    this.updateState({ isLoading: true, error: null });

    // Simulate OAuth redirect delay
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Mock OAuth flow - simulate redirect to Spotify
    const mockAuthUrl = `https://accounts.spotify.com/authorize?` +
      `client_id=mock_client_id&` +
      `response_type=code&` +
      `redirect_uri=${encodeURIComponent(window.location.origin + '/spotify-callback')}&` +
      `scope=user-library-read%20user-read-private&` +
      `state=mock_state_${Date.now()}`;

    console.log('🔵 MOCK: Would redirect to:', mockAuthUrl);
    
    // In a real implementation, this would redirect
    // For mock, we'll simulate successful connection
    setTimeout(() => {
      this.simulateSuccessfulConnection();
    }, 2000);

    return { success: true, data: { authUrl: mockAuthUrl } };
  }

  private simulateSuccessfulConnection(): void {
    console.log('✅ MOCK: Simulating successful connection');
    
    this.updateState({
      isConnected: true,
      isLoading: false,
      connection: this.mockConnection,
      healthStatus: 'healthy'
    });
  }

  async disconnectSpotify(): Promise<SpotifyOperationResult> {
    console.log('🔴 MOCK: Disconnecting from Spotify...');
    
    this.updateState({ isLoading: true, error: null });

    // Simulate disconnect delay
    await new Promise(resolve => setTimeout(resolve, 500));

    this.updateState({
      isConnected: false,
      isLoading: false,
      connection: null,
      healthStatus: 'unknown'
    });

    console.log('✅ MOCK: Disconnected successfully');
    return { success: true };
  }

  async refreshTokens(): Promise<SpotifyOperationResult> {
    console.log('🔄 MOCK: Refreshing tokens...');
    
    this.updateState({ isLoading: true, error: null });

    // Simulate token refresh delay
    await new Promise(resolve => setTimeout(resolve, 800));

    // Mock token refresh - update expiry time
    if (this.mockConnection) {
      this.mockConnection = {
        ...this.mockConnection,
        expires_at: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
        updated_at: new Date().toISOString()
      };

      this.updateState({
        isLoading: false,
        connection: this.mockConnection,
        healthStatus: 'healthy'
      });

      console.log('✅ MOCK: Tokens refreshed successfully');
      return { success: true, data: { connection: this.mockConnection } };
    } else {
      this.updateState({
        isLoading: false,
        error: 'No connection to refresh'
      });

      console.log('❌ MOCK: No connection to refresh');
      return { success: false, error: 'No connection to refresh' };
    }
  }

  async syncLikedSongs(forceFullSync: boolean = false): Promise<SpotifyOperationResult> {
    console.log('🎵 MOCK: Syncing liked songs...', { forceFullSync });
    
    this.updateState({ isLoading: true, error: null });

    // Simulate sync delay
    await new Promise(resolve => setTimeout(resolve, 2000));

    const mockSyncResult = {
      tracksProcessed: Math.floor(Math.random() * 500) + 100,
      newTracks: Math.floor(Math.random() * 50) + 10,
      updatedTracks: Math.floor(Math.random() * 20) + 5,
      syncType: forceFullSync ? 'full' : 'incremental'
    };

    this.updateState({ isLoading: false });

    console.log('✅ MOCK: Sync completed', mockSyncResult);
    return { success: true, data: mockSyncResult };
  }

  async performHealthCheck(): Promise<SpotifyOperationResult> {
    console.log('🏥 MOCK: Performing health check...');
    
    // Simulate health check delay
    await new Promise(resolve => setTimeout(resolve, 300));

    const healthStatuses: Array<'healthy' | 'warning' | 'error'> = ['healthy', 'warning', 'error'];
    const randomStatus = healthStatuses[Math.floor(Math.random() * healthStatuses.length)];

    this.updateState({ healthStatus: randomStatus });

    const healthResult = {
      status: randomStatus,
      lastCheck: new Date().toISOString(),
      checks: {
        tokenValidity: randomStatus !== 'error',
        apiConnectivity: randomStatus === 'healthy',
        vaultAccess: randomStatus !== 'error'
      }
    };

    console.log('✅ MOCK: Health check completed', healthResult);
    return { 
      success: randomStatus !== 'error', 
      data: healthResult,
      error: randomStatus === 'error' ? 'Health check failed' : undefined
    };
  }

  async validateSecurity(): Promise<SpotifyOperationResult> {
    console.log('🔒 MOCK: Validating security...');
    
    // Simulate security validation delay
    await new Promise(resolve => setTimeout(resolve, 400));

    const securityChecks = {
      tokenEncryption: true,
      vaultIntegrity: Math.random() > 0.1, // 90% chance of passing
      accessPatterns: Math.random() > 0.05, // 95% chance of passing
      auditTrail: true
    };

    const allPassed = Object.values(securityChecks).every(check => check);

    const securityResult = {
      isSecure: allPassed,
      lastValidation: new Date().toISOString(),
      checks: securityChecks,
      issues: allPassed ? [] : ['Some security checks failed']
    };

    console.log('✅ MOCK: Security validation completed', securityResult);
    return { 
      success: allPassed, 
      data: securityResult,
      error: allPassed ? undefined : 'Security validation failed'
    };
  }

  // Mock method to simulate different connection states for testing
  setMockConnectionState(connected: boolean, error?: string): void {
    console.log('🎭 MOCK: Setting connection state', { connected, error });
    
    this.updateState({
      isConnected: connected,
      connection: connected ? this.mockConnection : null,
      error: error || null,
      healthStatus: connected ? 'healthy' : 'error'
    });
  }

  // Mock method to simulate token expiry
  simulateTokenExpiry(): void {
    console.log('⏰ MOCK: Simulating token expiry');
    
    if (this.mockConnection) {
      this.mockConnection = {
        ...this.mockConnection,
        expires_at: new Date(Date.now() - 1000).toISOString() // Expired 1 second ago
      };

      this.updateState({
        connection: this.mockConnection,
        healthStatus: 'warning'
      });
    }
  }

  // Mock method to simulate various error scenarios
  simulateError(errorType: 'network' | 'auth' | 'api' | 'vault'): void {
    console.log('💥 MOCK: Simulating error', { errorType });
    
    const errorMessages = {
      network: 'Network connection failed',
      auth: 'Authentication failed - invalid credentials',
      api: 'Spotify API error - rate limit exceeded',
      vault: 'Vault access denied - security validation failed'
    };

    this.updateState({
      error: errorMessages[errorType],
      healthStatus: 'error',
      isLoading: false
    });
  }
}

// Export the class as default
export default MockSpotifyAuthManager;