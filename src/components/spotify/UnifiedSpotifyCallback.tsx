import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { SpotifyAuthManager } from '@/services/spotifyAuthManager.service';
import { useAuth } from '@/contexts/NewAuthContext';
import { Loader2, Music, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 3000, 5000]; // 1s, 3s, 5s

// Progress steps
const CALLBACK_STEPS = [
  "Validating authorization...",
  "Verifying security token...",
  "Exchanging tokens with Spotify...",
  "Storing credentials securely...",
  "Finalizing connection..."
];

// Retry wrapper for edge function calls
// IMPORTANT: Only retry on network errors (connection failures, timeouts)
// Do NOT retry on HTTP errors - OAuth authorization codes are single-use
// and will be invalid after the first attempt reaches Spotify
const callEdgeFunctionWithRetry = async (
  url: string,
  options: RequestInit,
  attempt = 0
): Promise<Response> => {
  try {
    const response = await fetch(url, options);
    // Do NOT retry on HTTP errors - the authorization code was already consumed
    // HTTP 400/401/etc means the request reached the server and the code is now invalid
    if (!response.ok) {
      console.log(`❌ HTTP ERROR: Status ${response.status} - not retrying (OAuth code already consumed)`);
    }
    return response;
  } catch (error) {
    // Only retry on network errors (fetch failed to reach the server)
    // These indicate the authorization code may not have been consumed yet
    if (attempt < MAX_RETRIES) {
      console.log(`🔄 RETRY: Network error on attempt ${attempt + 1}/${MAX_RETRIES}, retrying in ${RETRY_DELAYS[attempt]}ms`);
      await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
      return callEdgeFunctionWithRetry(url, options, attempt + 1);
    }
    throw error;
  }
};

export const UnifiedSpotifyCallback: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { loading: authLoading, isAuthenticated, session } = useAuth();
  const [isProcessing, setIsProcessing] = useState(true);
  const [callbackFailed, setCallbackFailed] = useState(false);
  const [failureReason, setFailureReason] = useState<string>('');
  const [currentStep, setCurrentStep] = useState(0);

  // Create refs to track current state values and avoid stale closures
  const authLoadingRef = useRef(authLoading);
  const sessionRef = useRef(session);

  // Keep refs in sync with state
  useEffect(() => {
    authLoadingRef.current = authLoading;
  }, [authLoading]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // Start a fresh OAuth flow (old authorization codes cannot be reused)
  const startFreshOAuthFlow = async () => {
    try {
      setCallbackFailed(false);
      setFailureReason('');
      setIsProcessing(true);

      // Clean up old state
      localStorage.removeItem('spotify_auth_state');
      sessionStorage.removeItem('spotify_auth_state_backup');
      sessionStorage.removeItem('unified_spotify_callback_processing');

      // Start a fresh OAuth flow
      const authManager = SpotifyAuthManager.getInstance();
      await authManager.connectSpotify();
      // This will redirect to Spotify, so no need to handle anything else
    } catch (error: any) {
      console.error('Failed to start fresh OAuth flow:', error);
      setCallbackFailed(true);
      setFailureReason(`Failed to restart connection: ${error.message}`);
      setIsProcessing(false);
    }
  };

  useEffect(() => {
    // Prevent multiple executions
    const executionFlag = 'unified_spotify_callback_processing';
    if (sessionStorage.getItem(executionFlag)) {
      console.log('🟡 UNIFIED CALLBACK: Already processing, skipping duplicate execution');
      return;
    }
    
    sessionStorage.setItem(executionFlag, 'true');
    
    // Declare code and state at the top level to avoid scope issues
    let code: string | null = null;
    let state: string | null = null;
    
    const processCallback = async () => {
      const startTime = Date.now();
      console.log('🟡 UNIFIED CALLBACK: Starting callback processing', {
        timestamp: new Date().toISOString(),
        authLoading,
        isAuthenticated,
        url: window.location.href
      });
      
      // Show initial processing toast with step progress
      setCurrentStep(1);
      toast({
        title: `Step 1/5`,
        description: CALLBACK_STEPS[0],
      });
      
      try {
        // Step 1: Parse URL parameters
        console.log('📋 UNIFIED CALLBACK: Step 1 - Parsing URL parameters');
        const urlParams = new URLSearchParams(window.location.search);
        code = urlParams.get('code');
        state = urlParams.get('state');
        const error = urlParams.get('error');

        console.log('🟡 UNIFIED CALLBACK: URL parameters parsed:', {
          hasCode: !!code,
          codeLength: code?.length,
          hasState: !!state,
          stateValue: state?.substring(0, 10) + '...',
          error,
          step: 1,
          elapsed: Date.now() - startTime
        });

        if (error) {
          console.log('❌ UNIFIED CALLBACK: Spotify returned error:', error);
          
          // SESSION DEBUG: Log session state before error handling
          console.log('🔍 SESSION DEBUG (Spotify Error): Session state before error handling', {
            hasSession: !!sessionRef.current,
            hasAccessToken: !!sessionRef.current?.access_token,
            hasUser: !!sessionRef.current?.user,
            userId: sessionRef.current?.user?.id,
            sessionExpiry: sessionRef.current?.expires_at,
            isAuthenticated,
            authLoading: authLoadingRef.current,
            error,
            timestamp: new Date().toISOString()
          });
          
          toast({
            title: "Spotify Connection Failed",
            description: `Error: ${error}`,
            variant: "destructive",
          });
          sessionStorage.removeItem(executionFlag);
          
          // SESSION DEBUG: Log session state after cleanup
          console.log('🔍 SESSION DEBUG (Spotify Error): Session state after cleanup', {
            hasSession: !!sessionRef.current,
            hasAccessToken: !!sessionRef.current?.access_token,
            preservedSession: 'Session should be preserved - no session clearing operations performed',
            timestamp: new Date().toISOString()
          });
          
          setTimeout(() => navigate('/'), 2000);
          return;
        }

        if (!code || !state) {
          console.log('❌ UNIFIED CALLBACK: Missing required parameters');
          
          // SESSION DEBUG: Log session state for missing parameters
          console.log('🔍 SESSION DEBUG (Missing Params): Session state during parameter validation failure', {
            hasSession: !!sessionRef.current,
            hasAccessToken: !!sessionRef.current?.access_token,
            hasUser: !!sessionRef.current?.user,
            userId: sessionRef.current?.user?.id,
            isAuthenticated,
            missingCode: !code,
            missingState: !state,
            preservedSession: 'Session should be preserved - no session clearing operations performed',
            timestamp: new Date().toISOString()
          });
          
          toast({
            title: "Authentication Error",
            description: "Missing authorization code or state",
            variant: "destructive",
          });
          sessionStorage.removeItem(executionFlag);
          setTimeout(() => navigate('/'), 2000);
          return;
        }

        // Step 2: Verify state parameter
        console.log('🔐 UNIFIED CALLBACK: Step 2 - Verifying state parameter');
        const storedState = localStorage.getItem('spotify_auth_state');
        const backupState = sessionStorage.getItem('spotify_auth_state_backup');
        
        console.log('🔐 UNIFIED CALLBACK: State verification:', {
          receivedState: state?.substring(0, 10) + '...',
          storedState: storedState?.substring(0, 10) + '...',
          backupState: backupState?.substring(0, 10) + '...',
          stateMatches: state === storedState || state === backupState,
          step: 2,
          elapsed: Date.now() - startTime
        });
        
        if (state !== storedState && state !== backupState) {
          console.log('❌ UNIFIED CALLBACK: State parameter mismatch');
          
          // SESSION DEBUG: Log session state for state mismatch
          console.log('🔍 SESSION DEBUG (State Mismatch): Session state during security validation failure', {
            hasSession: !!sessionRef.current,
            hasAccessToken: !!sessionRef.current?.access_token,
            hasUser: !!sessionRef.current?.user,
            userId: sessionRef.current?.user?.id,
            isAuthenticated,
            receivedState: state?.substring(0, 10) + '...',
            storedState: storedState?.substring(0, 10) + '...',
            backupState: backupState?.substring(0, 10) + '...',
            preservedSession: 'Session should be preserved - no session clearing operations performed',
            timestamp: new Date().toISOString()
          });
          
          toast({
            title: "Security Error",
            description: "Invalid state parameter - please try connecting again",
            variant: "destructive",
          });
          
          // Clean up stored states
          localStorage.removeItem('spotify_auth_state');
          sessionStorage.removeItem('spotify_auth_state_backup');
          sessionStorage.removeItem(executionFlag);
          
          setTimeout(() => navigate('/'), 2000);
          return;
        }

        // Step 3: Wait for auth context to stabilize
        console.log('⏳ UNIFIED CALLBACK: Step 3 - Waiting for auth context');
        const maxWaitTime = 5000;
        const startWait = Date.now();

        while (authLoadingRef.current && (Date.now() - startWait) < maxWaitTime) {
          console.log('⏳ UNIFIED CALLBACK: Auth still loading, waiting 100ms...', {
            elapsed: Date.now() - startWait,
            maxWait: maxWaitTime,
            authLoadingRef: authLoadingRef.current
          });
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (Date.now() - startWait >= maxWaitTime) {
          console.error('❌ UNIFIED CALLBACK: Auth context timeout', {
            elapsed: Date.now() - startWait,
            maxWait: maxWaitTime
          });
          
          // SESSION RECOVERY: Try direct session fetch before giving up
          console.log('⏳ Auth context timeout - attempting direct session fetch');
          const { data: { session: directSession } } = await supabase.auth.getSession();
          
          if (directSession?.access_token) {
            // Use direct session instead
            sessionRef.current = directSession;
            console.log('✅ Recovered session via direct fetch');
            
            toast({
              title: "Session Recovered",
              description: "Continuing with Spotify connection...",
            });
          } else {
            // SESSION DEBUG: Log session state for auth timeout
            console.log('🔍 SESSION DEBUG (Auth Timeout): Session state during auth context timeout', {
              hasSession: !!sessionRef.current,
              hasAccessToken: !!sessionRef.current?.access_token,
              hasUser: !!sessionRef.current?.user,
              userId: sessionRef.current?.user?.id,
              isAuthenticated,
              authLoadingRef: authLoadingRef.current,
              timeoutElapsed: Date.now() - startWait,
              maxWaitTime,
              directSessionRecovery: 'Failed to recover session via direct fetch',
              timestamp: new Date().toISOString()
            });
            
            // Show actionable error with retry button
            setCallbackFailed(true);
            setFailureReason("Session recovery failed. Please log in again and retry connecting Spotify.");
            sessionStorage.removeItem(executionFlag);
            return;
          }
        }

        console.log('✅ UNIFIED CALLBACK: Auth context ready', {
          elapsed: Date.now() - startWait,
          authLoading: authLoadingRef.current,
          isAuthenticated,
          hasSession: !!sessionRef.current
        });

        // Show validation success with step progress
        setCurrentStep(3);
        toast({
          title: `Step 3/5`,
          description: CALLBACK_STEPS[2],
        });

        // Step 4: Use session from auth context
        const currentSession = sessionRef.current;
        console.log('📡 UNIFIED CALLBACK: Step 4 - Using session from auth context', {
          hasSession: !!currentSession,
          hasAccessToken: !!currentSession?.access_token,
          hasUser: !!currentSession?.user,
          userId: currentSession?.user?.id,
          step: 4
        });

        if (!currentSession || !currentSession.access_token) {
          console.log('❌ UNIFIED CALLBACK: No valid session in auth context', {
            hasSession: !!currentSession,
            hasAccessToken: !!currentSession?.access_token,
            isAuthenticated,
            step: 4,
            elapsed: Date.now() - startTime
          });
          
          // SESSION DEBUG: Log detailed session state for missing session
          console.log('🔍 SESSION DEBUG (No Session): Detailed session analysis during session validation failure', {
            currentSession: currentSession ? {
              hasAccessToken: !!currentSession.access_token,
              hasRefreshToken: !!currentSession.refresh_token,
              hasUser: !!currentSession.user,
              userId: currentSession.user?.id,
              expiresAt: currentSession.expires_at,
              tokenType: currentSession.token_type
            } : null,
            sessionRef: sessionRef.current ? {
              hasAccessToken: !!sessionRef.current.access_token,
              hasRefreshToken: !!sessionRef.current.refresh_token,
              hasUser: !!sessionRef.current.user,
              userId: sessionRef.current.user?.id,
              expiresAt: sessionRef.current.expires_at
            } : null,
            isAuthenticated,
            authLoadingRef: authLoadingRef.current,
            sessionLost: 'Session appears to have been lost during Spotify auth flow',
            timestamp: new Date().toISOString()
          });
          
          toast({
            title: "Authentication Required",
            description: "Please log in to connect Spotify",
            variant: "destructive",
          });
          sessionStorage.removeItem(executionFlag);
          setTimeout(() => navigate('/auth'), 2000);
          return;
        }

        // Step 5: Call edge function with direct fetch (bypassing SDK)
        console.log('🚀 UNIFIED CALLBACK: Step 5 - Calling spotify-auth edge function with direct fetch');
        const edgeFunctionStartTime = Date.now();
        const redirectUri = `${window.location.origin}/spotify-callback`;
        
        // Get Supabase configuration
        const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://bzzstdpfmyqttnzhgaoa.supabase.co";
        const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ||
          import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ6enN0ZHBmbXlxdHRuemhnYW9hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg0NzI5NzMsImV4cCI6MjA2NDA0ODk3M30.NXT4XRuPilV2AV6KYY56-vk3AqZ8I2DQKkVjfbMcWoI";
        
        const edgeFunctionUrl = `${SUPABASE_URL}/functions/v1/spotify-auth`;
        
        console.log('🚀 CALLING EDGE FUNCTION (DIRECT FETCH):', {
          url: edgeFunctionUrl,
          redirectUri,
          codeLength: code?.length,
          hasAuth: !!currentSession.access_token,
          hasAnonKey: !!SUPABASE_ANON_KEY,
          timestamp: new Date().toISOString(),
          step: 5
        });
        
        // Step 5a: Test CORS preflight explicitly
        console.log('🔍 PRE-FLIGHT: Testing OPTIONS request...');
        try {
          const preflightResponse = await fetch(edgeFunctionUrl, {
            method: 'OPTIONS',
          });
          console.log('✅ PRE-FLIGHT: OPTIONS response:', {
            status: preflightResponse.status,
            statusText: preflightResponse.statusText,
            headers: Object.fromEntries(preflightResponse.headers.entries())
          });
        } catch (preflightError: any) {
          console.error('❌ PRE-FLIGHT: OPTIONS failed:', {
            message: preflightError.message,
            name: preflightError.name,
            type: preflightError.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK'
          });
        }
        
        // Step 5b: Make the actual request with retry logic
        setCurrentStep(4);
        toast({
          title: `Step 4/5`,
          description: CALLBACK_STEPS[3],
        });
        
        const edgeFunctionPromise = (async () => {
          try {
            console.log('📡 DIRECT FETCH: Starting POST request with retry logic...');
            const response = await callEdgeFunctionWithRetry(edgeFunctionUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentSession.access_token}`,
                'apikey': SUPABASE_ANON_KEY,
              },
              body: JSON.stringify({ code, state, redirect_uri: redirectUri }),
            });
            
            const elapsed = Date.now() - edgeFunctionStartTime;
            console.log('📡 DIRECT FETCH: Response received:', {
              status: response.status,
              statusText: response.statusText,
              ok: response.ok,
              elapsed,
              headers: Object.fromEntries(response.headers.entries())
            });
            
            if (!response.ok) {
              const errorText = await response.text();
              console.error('❌ DIRECT FETCH: Edge function HTTP error:', {
                status: response.status,
                statusText: response.statusText,
                errorText,
                elapsed
              });
              throw new Error(`Edge function error ${response.status}: ${errorText}`);
            }
            
            const data = await response.json();
            console.log('✅ DIRECT FETCH: Edge function completed successfully:', {
              elapsed,
              hasData: !!data,
              step: 5,
              timestamp: new Date().toISOString()
            });
            
            return { data, error: null };
            
          } catch (networkError: any) {
            const elapsed = Date.now() - edgeFunctionStartTime;
            const errorType = networkError.name === 'AbortError' ? 'NETWORK_TIMEOUT' :
                             networkError.message?.includes('timeout') ? 'SERVER_TIMEOUT' :
                             networkError.message?.includes('fetch') || networkError.message?.includes('Failed to fetch') ? 'NETWORK_ERROR' : 'SERVER_ERROR';
            
            console.error('❌ DIRECT FETCH: Network error:', {
              message: networkError.message,
              name: networkError.name,
              type: errorType,
              elapsed,
              step: 5,
              timestamp: new Date().toISOString()
            });
            
            // Enhance error with type information
            networkError.errorType = errorType;
            throw networkError;
          }
        })();

        let edgeFunctionTimeoutId: ReturnType<typeof setTimeout>;
        const edgeFunctionTimeoutPromise = new Promise<any>((_, reject) => {
          edgeFunctionTimeoutId = setTimeout(() => {
            const elapsed = Date.now() - edgeFunctionStartTime;
            console.error('❌ DIRECT FETCH: Edge function timeout', {
              elapsed,
              timeout: 45000,
              step: 5,
              timestamp: new Date().toISOString()
            });
            const timeoutError = new Error('Edge function timeout - never reached server');
            (timeoutError as any).errorType = 'NETWORK_TIMEOUT';
            reject(timeoutError);
          }, 45000); // 45s timeout for cold-start edge functions
        });

        const response = await Promise.race([
          edgeFunctionPromise.finally(() => clearTimeout(edgeFunctionTimeoutId!)),
          edgeFunctionTimeoutPromise,
        ]);

        if (response.error) {
          console.error('❌ UNIFIED CALLBACK: Edge function error:', {
            error: response.error,
            step: 5,
            elapsed: Date.now() - startTime
          });
          
          // SESSION DEBUG: Log session state for edge function error
          console.log('🔍 SESSION DEBUG (Edge Function Error): Session state during edge function failure', {
            hasSession: !!sessionRef.current,
            hasAccessToken: !!sessionRef.current?.access_token,
            hasUser: !!sessionRef.current?.user,
            userId: sessionRef.current?.user?.id,
            isAuthenticated,
            edgeFunctionError: response.error?.message,
            preservedSession: 'Session should be preserved - edge function failure should not affect existing session',
            timestamp: new Date().toISOString()
          });
          
          toast({
            title: "Connection Failed",
            description: `Failed to connect: ${response.error.message}`,
            variant: "destructive",
          });
          sessionStorage.removeItem(executionFlag);
          setTimeout(() => navigate('/'), 2000);
          return;
        }

        // Step 6: Update auth manager state optimistically
        // Since the edge function succeeded, we know the connection was created
        // Don't wait for a potentially slow database query - update state immediately
        console.log('🔄 UNIFIED CALLBACK: Step 6 - Updating auth manager state optimistically');

        const authManager = SpotifyAuthManager.getInstance();

        // Use the data from the edge function response to set connected state
        if (response.data?.data?.spotifyUserId) {
          authManager.setConnectedOptimistically(
            response.data.data.spotifyUserId,
            response.data.data.displayName
          );
          console.log('✅ UNIFIED CALLBACK: Auth manager state updated optimistically', {
            spotifyUserId: response.data.data.spotifyUserId,
            displayName: response.data.data.displayName,
            step: 6
          });
        } else {
          // Fallback: trigger a background refresh (don't await)
          console.log('⚠️ UNIFIED CALLBACK: No Spotify user data in response, triggering background refresh');
          authManager.checkConnection(true).catch(err => {
            console.warn('Background connection check failed:', err);
          });
        }

        // Step 7: Clean up and complete
        console.log('🧹 UNIFIED CALLBACK: Step 7 - Cleaning up and completing');
        localStorage.removeItem('spotify_auth_state');
        sessionStorage.removeItem('spotify_auth_state_backup');
        sessionStorage.removeItem(executionFlag);

        const totalElapsed = Date.now() - startTime;
        console.log('✅ UNIFIED CALLBACK: Process completed successfully', {
          totalElapsed,
          steps: 7,
          timestamp: new Date().toISOString()
        });

        // Show success message
        toast({
          title: "Spotify Connected!",
          description: "Your Spotify account has been successfully connected.",
        });

        // Navigate back to main page
        setTimeout(() => navigate('/'), 1500);

      } catch (error: any) {
        console.error('❌ UNIFIED CALLBACK: Critical error:', error);
        
        // SESSION DEBUG: Log session state during critical error
        console.log('🔍 SESSION DEBUG (Critical Error): Session state during critical callback error', {
          hasSession: !!sessionRef.current,
          hasAccessToken: !!sessionRef.current?.access_token,
          hasUser: !!sessionRef.current?.user,
          userId: sessionRef.current?.user?.id,
          isAuthenticated,
          authLoadingRef: authLoadingRef.current,
          criticalError: error.message,
          errorType: error.errorType || 'unknown',
          errorName: error.name,
          preservedSession: 'Session preservation strategy - avoiding additional session checks that might corrupt auth state',
          timestamp: new Date().toISOString()
        });
        
        // Show retry UI instead of auto-navigating
        setCallbackFailed(true);
        setFailureReason(`Failed to connect to Spotify: ${error.message}`);
        sessionStorage.removeItem(executionFlag);
      } finally {
        setIsProcessing(false);
      }
    };

    processCallback();
  }, [navigate, toast, authLoading, isAuthenticated]);

  // Show retry UI when callback failed
  if (callbackFailed) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background to-muted flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4 p-6 bg-card rounded-lg shadow-lg max-w-md">
          <AlertCircle className="w-12 h-12 text-destructive" />
          <h2 className="text-xl font-semibold">Connection Failed</h2>
          <p className="text-muted-foreground text-center">{failureReason}</p>
          <div className="flex gap-2 w-full">
            <Button onClick={() => startFreshOAuthFlow()} className="flex-1">
              <RefreshCw className="w-4 h-4 mr-2" />
              Reconnect Spotify
            </Button>
            <Button variant="outline" onClick={() => navigate('/')}>
              Return to Dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Enhanced loading screen with step progress
  if (isProcessing) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background to-muted flex items-center justify-center p-4">
        <div className="flex flex-col items-center space-y-4">
          <div className="p-4 bg-green-500/10 rounded-full">
            <Music className="h-8 w-8 text-green-500" />
          </div>
          <div className="flex items-center space-x-2">
            <Loader2 className="h-5 w-5 animate-spin text-green-500" />
            <span className="text-lg font-medium">Connecting to Spotify...</span>
          </div>
          {currentStep > 0 && (
            <div className="text-center">
              <p className="text-sm font-medium text-green-600">
                Step {currentStep}/5
              </p>
              <p className="text-sm text-muted-foreground">
                {CALLBACK_STEPS[currentStep - 1]}
              </p>
            </div>
          )}
          <p className="text-sm text-muted-foreground text-center max-w-md">
            Please wait while we securely process your Spotify authorization.
            You'll be redirected automatically.
          </p>
        </div>
      </div>
    );
  }

  // This should rarely be seen as the component redirects quickly
  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted flex items-center justify-center p-4">
      <div className="text-center">
        <p className="text-lg">Processing complete. Redirecting...</p>
      </div>
    </div>
  );
};

export default UnifiedSpotifyCallback;