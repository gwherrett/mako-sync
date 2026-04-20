import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { User, Session, AuthError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { AuthService, SignUpData, SignInData } from '@/services/auth.service';
import { UserService, UserProfile } from '@/services/user.service';
import { SessionService } from '@/services/session.service';
import { AuthRetryService } from '@/services/authRetry.service';
import { AuthStateRecoveryService } from '@/services/authStateRecovery.service';
import { ErrorHandlingService } from '@/services/errorHandling.service';
import { ErrorLoggingService } from '@/services/errorLogging.service';
import { sessionCache } from '@/services/sessionCache.service';
import { startupSessionValidator } from '@/services/startupSessionValidator.service';
import { tokenPersistenceGateway } from '@/services/tokenPersistenceGateway.service';
import { useAuthErrors } from '@/hooks/useAuthErrors';
import { useToast } from '@/hooks/use-toast';
import { useVisibilityTokenRefresh } from '@/hooks/useVisibilityTokenRefresh';
import { logger } from '@/utils/logger';
import { featureFlags } from '@/utils/featureFlags';

export interface AuthContextType {
  // Core state
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  role: 'admin' | 'user' | null;
  loading: boolean;
  initialDataReady: boolean; // Signals that auth initialization is complete and data queries can start
  dataFetchEnabled: boolean; // False until signed in, reset to false on sign-out — general gate for non-Spotify queries
  spotifyDataFetchEnabled: boolean; // False during Spotify token-refresh settle window — gates Spotify-specific queries

  // Auth states
  isAuthenticated: boolean;
  isEmailVerified: boolean;
  isOnboardingComplete: boolean;

  // Auth actions
  signUp: (data: SignUpData) => Promise<boolean>;
  signIn: (data: SignInData) => Promise<boolean>;
  signOut: () => Promise<void>;
  resendConfirmation: (email: string) => Promise<boolean>;
  resetPassword: (email: string) => Promise<boolean>;
  updatePassword: (password: string) => Promise<boolean>;

  // Profile actions
  updateProfile: (updates: Partial<UserProfile>) => Promise<boolean>;
  refreshProfile: () => Promise<void>;

  // Session actions
  refreshSession: () => Promise<void>;

  // Recovery actions
  recoverAuthState: () => Promise<boolean>;

  // Role checks
  hasRole: (role: 'admin' | 'user') => boolean;
  isAdmin: boolean;

  // Error handling
  error: AuthError | null;
  clearError: () => void;

  // Enhanced error info
  lastErrorContext: any;
  errorRecoveryAvailable: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within a NewAuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: React.ReactNode;
}

export const NewAuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  // Core state
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [role, setRole] = useState<'admin' | 'user' | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialDataReady, setInitialDataReady] = useState(false); // Signals data queries can start
  const [dataFetchEnabled, setDataFetchEnabled] = useState(false); // General gate — true when signed in
  const [spotifyDataFetchEnabled, setSpotifyDataFetchEnabled] = useState(false); // Spotify gate — false during token-refresh settle window
  const spotifyDataFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialDataReadyRef = useRef(false); // Ref so onAuthStateChange closure always sees current value

  // Update refs when state changes
  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { profileRef.current = profile; }, [profile]);
  useEffect(() => { roleRef.current = role; }, [role]);
  useEffect(() => { initialDataReadyRef.current = initialDataReady; }, [initialDataReady]);

  // Error handling
  const { error, setError, clearError, setLoading: setErrorLoading, handleError } = useAuthErrors();
  const { toast } = useToast();
  const initializationRef = useRef(false);

  // Proactively refresh tokens when tab becomes visible after idle
  useVisibilityTokenRefresh();
  const sessionValidatedRef = useRef(false); // Track if session has been validated with server

  // DEDUPLICATION: Track recent SIGNED_IN events to prevent duplicate processing
  const lastSignedInUserRef = useRef<string | null>(null);
  const lastSignedInTimeRef = useRef<number>(0);

  // Refs for logging without causing re-renders
  const userRef = useRef<User | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const profileRef = useRef<UserProfile | null>(null);
  const roleRef = useRef<'admin' | 'user' | null>(null);
  const [lastErrorContext, setLastErrorContext] = useState<any>(null);
  const [errorRecoveryAvailable, setErrorRecoveryAvailable] = useState(false);

  // Initialize enhanced error handling services
  useEffect(() => {
    ErrorLoggingService.initialize({
      enableConsoleLogging: true,
      enableLocalStorage: true,
      logLevels: ['info', 'warn', 'error', 'critical']
    });

    // Setup auto backup
    const cleanupBackup = AuthStateRecoveryService.setupAutoBackup();

    return cleanupBackup;
  }, []);

  // Load user profile and role
  const loadUserData = useCallback(async (userId: string) => {
    try {
      const [profileResult, roleResult] = await Promise.all([
        UserService.getUserProfile(userId),
        UserService.getUserRole(userId)
      ]);

      if (profileResult.profile) {
        setProfile(profileResult.profile);
      }

      if (roleResult.role) {
        setRole(roleResult.role);
      }
    } catch (error) {
      logger.auth('Error loading user data', { error }, 'error');
    }
  }, []);

  // Clear user data - stabilized with no state dependencies
  const clearUserData = useCallback(() => {
    setUser(null);
    setSession(null);
    setProfile(null);
    setRole(null);
  }, []); // Empty dependency array - no state dependencies

  // Initialize auth state with aggressive startup validation
  const initializeAuth = useCallback(async () => {
    if (initializationRef.current) {
      return;
    }

    initializationRef.current = true;
    logger.auth('Initializing');

    try {
      // AGGRESSIVE VALIDATION: Validate cached tokens BEFORE processing any auth state
      // Feature flag allows disabling this for testing if it's over-engineered
      if (featureFlags.isStartupValidatorEnabled()) {
        const validationResult = await startupSessionValidator.validateOnStartup();

        // If tokens were cleared due to staleness, show notification and exit early
        if (validationResult.wasCleared) {
          logger.auth('Session expired');
          toast({
            title: 'Session Expired',
            description: 'Your previous session has expired. Please sign in again.',
            variant: 'destructive'
          });

          clearUserData();
          sessionValidatedRef.current = true; // Mark as validated (no valid session)
          return;
        }

        // OPTIMIZATION: If externally validated (via TOKEN_REFRESHED/SIGNED_IN),
        // skip the redundant getCurrentSession call
        if (validationResult.reason?.includes('externally validated')) {
          sessionValidatedRef.current = true;
          return;
        }
      } else {
        logger.auth('Startup validator disabled via feature flag');
      }

      // Now proceed with normal session check (tokens are validated)
      const { session, error } = await AuthService.getCurrentSession('initialization');

      // CRITICAL FIX: Mark session as validated IMMEDIATELY after server check
      sessionValidatedRef.current = true;

      if (error) {
        const isTimeoutError = error.message?.includes('timeout');
        const isStaleTokenError = error.message?.includes('Stale token detected');

        if (isStaleTokenError) {
          sessionCache.clearCache();
          toast({
            title: 'Session Expired',
            description: 'Your session has expired. Please sign in again.',
            variant: 'destructive'
          });
          clearUserData();
          return;
        }

        if (isTimeoutError) {
          // Try to recover from local storage or use guest mode
          try {
            const recoveryResult = await AuthStateRecoveryService.recoverAuthState();
            if (recoveryResult.success && recoveryResult.newState?.session) {
              logger.auth('Session recovered from backup');
              setSession(recoveryResult.newState.session);
              setUser(recoveryResult.newState.user);
              setProfile(recoveryResult.newState.profile);
              setRole(recoveryResult.newState.role);
              return;
            }
          } catch (recoveryError) {
            logger.auth('Recovery failed', { error: recoveryError }, 'error');
          }

          toast({
            title: 'Connection Timeout',
            description: 'Having trouble connecting. You can continue in offline mode or try refreshing.',
            variant: 'destructive'
          });
        }

        clearUserData();
        return;
      }

      if (session?.user) {
        logger.auth('Session validated');
        setSession(session);
        setUser(session.user);

        // Load user data after session is established
        setTimeout(() => {
          loadUserData(session.user.id);
        }, 0);
      } else {
        clearUserData();
      }
    } catch (error) {
      logger.auth('Initialization error', { error }, 'error');

      // Mark as validated even on error to prevent hanging UI
      sessionValidatedRef.current = true;

      const isTimeoutError = error instanceof Error && error.message?.includes('timeout');
      if (isTimeoutError) {
        toast({
          title: 'Slow Connection Detected',
          description: 'Authentication is taking longer than usual. Please check your internet connection.',
          variant: 'destructive'
        });
      }

      clearUserData();
    } finally {
      setLoading(false);
      setInitialDataReady(true); // Signal that data queries can now start
      setDataFetchEnabled(true); // Allow data queries (no token-refresh in progress)
      logger.auth('Ready');
    }
  }, [loadUserData, toast, clearUserData]);

  // Auth state change handler with enhanced race condition protection
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        // ENHANCED RACE CONDITION PROTECTION
        // Block ALL auth state changes until initialization completes server validation
        if (!sessionValidatedRef.current) {
          // Only allow critical auth events that bypass initialization
          const isCriticalEvent = ['SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED', 'TOKEN_REFRESHED'].includes(event);

          if (!isCriticalEvent) {
            return;
          }

          // For critical events, mark as validated to allow processing
          sessionValidatedRef.current = true;
        }

        // Additional protection: Ensure initialization has started
        if (!initializationRef.current && event === 'INITIAL_SESSION') {
          return;
        }

        // ATOMIC STATE UPDATE: Update all auth state together to prevent partial updates
        const updateAuthState = () => {
          setSession(session);
          setUser(session?.user ?? null);

          // Only update loading state if not during initialization
          if (initializationRef.current) {
            setLoading(false);
          }
        };

        // Handle specific auth events with proper sequencing
        switch (event) {
        case 'SIGNED_IN':
            if (session?.user) {
              // CRITICAL FIX: Always mark as validated for ANY SIGNED_IN event
              if (featureFlags.isStartupValidatorEnabled()) {
                startupSessionValidator.markAsValidated();
              }

              // OPTIMIZATION: Pre-populate session cache to avoid redundant getSession() calls
              sessionCache.setSessionFromAuthContext(session);

              const now = Date.now();
              const timeSinceLastSignIn = now - lastSignedInTimeRef.current;

              // EXTENDED DEDUPLICATION: Check if this is the same user within 60 seconds
              const isSameUserRecently =
                lastSignedInUserRef.current === session.user.id &&
                timeSinceLastSignIn < 60000; // Within 60 seconds

              // CRITICAL FIX: Also check if we're already authenticated with this user
              const isAlreadyAuthenticated =
                userRef.current?.id === session.user.id ||
                sessionRef.current?.user?.id === session.user.id;

              // If same user recently signed in OR already authenticated, treat as token refresh.
              // Use initialDataReadyRef (not the state value) so the closure always sees the
              // current value — the onAuthStateChange handler is set up once at mount time and
              // the state variable in the closure would otherwise always be the initial `false`.
              if (isSameUserRecently || (isAlreadyAuthenticated && initialDataReadyRef.current)) {
                // Just update the session/user state without full re-initialization
                setSession(session);
                setUser(session.user);

                // Update tracking for next event
                lastSignedInTimeRef.current = now;
                return; // Don't trigger data reload or cascading effects
              }

              // This is a genuine new sign-in - update tracking
              lastSignedInUserRef.current = session.user.id;
              lastSignedInTimeRef.current = now;

              logger.auth('Signed in');
              updateAuthState();

              // Wait for token persistence before allowing queries
              // This prevents the race condition where queries start before
              // the token is actually persisted to localStorage
              if (featureFlags.isTokenPersistenceGatewayEnabled()) {
                tokenPersistenceGateway.waitForTokenPersistence(session, 300)
                  .finally(() => {
                    setInitialDataReady(true); // Allow data queries to start
                    setDataFetchEnabled(true);
                    setSpotifyDataFetchEnabled(true);
                  });
              } else {
                setInitialDataReady(true); // Allow data queries immediately
                setDataFetchEnabled(true);
                setSpotifyDataFetchEnabled(true);
              }

              // Defer data loading to prevent deadlocks
              setTimeout(() => {
                loadUserData(session.user.id);
              }, 0);
            }
            break;

          case 'SIGNED_OUT':
            logger.auth('Signed out');
            clearUserData();
            if (featureFlags.isTokenPersistenceGatewayEnabled()) {
              tokenPersistenceGateway.reset(); // Reset gateway state for next sign-in
            }
            if (spotifyDataFetchTimerRef.current) {
              clearTimeout(spotifyDataFetchTimerRef.current);
              spotifyDataFetchTimerRef.current = null;
            }
            setDataFetchEnabled(false); // Reset for next sign-in
            setSpotifyDataFetchEnabled(false); // Reset for next sign-in
            setLoading(false);
            setInitialDataReady(true); // Allow UI to reset properly
            break;

          case 'TOKEN_REFRESHED':
            if (session) {
              // CRITICAL: Mark startup validator as externally validated
              if (featureFlags.isStartupValidatorEnabled()) {
                startupSessionValidator.markAsValidated();
              }

              // OPTIMIZATION: Pre-populate session cache
              sessionCache.setSessionFromAuthContext(session);

              // Update session/user state directly — token refresh doesn't change user
              // identity so a full updateAuthState() (which reloads user data) is not needed.
              setSession(session);
              setUser(session.user);

              // Block data queries during the token-refresh settle window.
              // The Supabase client's internal setSession lock may still be held when
              // TOKEN_REFRESHED fires. Any DB query started before the lock is released
              // will timeout. We gate queries for 1500ms to guarantee the lock has cleared.
              // When dataFetchEnabled transitions false → true, query useEffects re-run
              // automatically, giving the "render stale data then auto-refresh" behaviour.
              setSpotifyDataFetchEnabled(false);
              if (spotifyDataFetchTimerRef.current) clearTimeout(spotifyDataFetchTimerRef.current);
              spotifyDataFetchTimerRef.current = setTimeout(() => {
                setSpotifyDataFetchEnabled(true);
                spotifyDataFetchTimerRef.current = null;
              }, 1500);

              // Wait for token persistence before allowing queries.
              // Skip the redundant setSession call: Supabase has already refreshed
              // the token internally so calling setSession() again just causes
              // noisy timeout warnings during long scans.
              if (featureFlags.isTokenPersistenceGatewayEnabled()) {
                tokenPersistenceGateway.waitForTokenPersistence(session, 300, { skipSetSession: true })
                  .finally(() => {
                    setInitialDataReady(true); // Allow data queries to start
                  });
              } else {
                setInitialDataReady(true); // Allow data queries immediately
              }
            }
            break;

          case 'USER_UPDATED':
            updateAuthState();
            if (session?.user) {
              setTimeout(() => {
                loadUserData(session.user.id);
              }, 0);
            }
            break;

          default:
            // For other events, just update state if we have a session
            if (session) {
              updateAuthState();
            } else {
              clearUserData();
              setLoading(false);
            }
        }
      }
    );

    // Initialize auth state - this performs server-side validation
    initializeAuth();

    return () => {
      subscription.unsubscribe();
    };
  }, [initializeAuth, loadUserData, clearUserData]);

  // Auth actions
  const signUp = useCallback(async (data: SignUpData): Promise<boolean> => {
    setErrorLoading(true);
    clearError();

    try {
      ErrorLoggingService.logAuthEvent('signUp_attempt', 'info', {
        operation: 'signUp',
        component: 'NewAuthContext'
      });

      const result = await AuthRetryService.signUpWithRetry(data);

      if (!result.success || result.error) {
        const errorResult = ErrorHandlingService.handleError(result.error!, {
          operation: 'signUp',
          component: 'NewAuthContext',
          additionalData: { email: data.email, attempts: result.attempts }
        });

        setLastErrorContext(errorResult);
        handleError(result.error as AuthError);

        ErrorLoggingService.logAuthEvent('signUp_failed', 'error', {
          operation: 'signUp',
          component: 'NewAuthContext'
        }, { attempts: result.attempts, totalTime: result.totalTime });

        return false;
      }

      if (result.data?.user) {
        toast({
          title: 'Account Created',
          description: 'Please check your email to verify your account.',
        });

        ErrorLoggingService.logAuthEvent('signUp_success', 'info', {
          operation: 'signUp',
          component: 'NewAuthContext'
        }, { attempts: result.attempts, totalTime: result.totalTime });

        return true;
      }

      return false;
    } catch (error) {
      const errorResult = ErrorHandlingService.handleError(error as AuthError, {
        operation: 'signUp',
        component: 'NewAuthContext'
      });

      setLastErrorContext(errorResult);
      handleError(error as AuthError);
      return false;
    } finally {
      setErrorLoading(false);
    }
  }, [setErrorLoading, clearError, handleError, toast]);

  const signIn = useCallback(async (data: SignInData): Promise<boolean> => {
    setErrorLoading(true);
    clearError();

    try {
      ErrorLoggingService.logAuthEvent('signIn_attempt', 'info', {
        operation: 'signIn',
        component: 'NewAuthContext'
      });

      const result = await AuthRetryService.signInWithRetry(data);

      if (!result.success || result.error) {
        const errorResult = ErrorHandlingService.handleError(result.error!, {
          operation: 'signIn',
          component: 'NewAuthContext',
          additionalData: { email: data.email, attempts: result.attempts }
        });

        setLastErrorContext(errorResult);
        setErrorRecoveryAvailable(errorResult.shouldRetry);
        handleError(result.error as AuthError);

        ErrorLoggingService.logAuthEvent('signIn_failed', 'error', {
          operation: 'signIn',
          component: 'NewAuthContext'
        }, { attempts: result.attempts, totalTime: result.totalTime });

        return false;
      }

      if (result.data?.user && result.data?.session) {
        toast({
          title: 'Welcome back!',
          description: 'Successfully signed in.',
        });

        ErrorLoggingService.logAuthEvent('signIn_success', 'info', {
          operation: 'signIn',
          component: 'NewAuthContext'
        }, { attempts: result.attempts, totalTime: result.totalTime });

        return true;
      }

      return false;
    } catch (error) {
      const errorResult = ErrorHandlingService.handleError(error as AuthError, {
        operation: 'signIn',
        component: 'NewAuthContext'
      });

      setLastErrorContext(errorResult);
      handleError(error as AuthError);
      return false;
    } finally {
      setErrorLoading(false);
    }
  }, [setErrorLoading, clearError, handleError, toast]);

  const signOut = useCallback(async (): Promise<void> => {
    try {
      setErrorLoading(true);
      clearError();

      const { error } = await AuthService.signOut();

      if (error) {
        logger.auth('SignOut error', { error }, 'error');
        handleError(error, 'Failed to sign out. Please try again.');
        return;
      }

      // Clear user data and cache
      clearUserData();
      sessionCache.clearCache();
      if (featureFlags.isTokenPersistenceGatewayEnabled()) {
        tokenPersistenceGateway.reset();
      }

      toast({
        title: 'Signed Out',
        description: 'You have been successfully signed out.',
      });

    } catch (error) {
      logger.auth('SignOut exception', { error }, 'error');
      handleError(error as AuthError);

      // Even if signOut fails, clear local state and navigate
      clearUserData();
      sessionCache.clearCache();
      if (featureFlags.isTokenPersistenceGatewayEnabled()) {
        tokenPersistenceGateway.reset();
      }
    } finally {
      setErrorLoading(false);
    }
  }, [setErrorLoading, clearError, handleError, toast, clearUserData]);

  const resendConfirmation = useCallback(async (email: string): Promise<boolean> => {
    setErrorLoading(true);
    clearError();

    try {
      const { error } = await AuthService.resendConfirmation(email);

      if (error) {
        handleError(error);
        return false;
      }

      toast({
        title: 'Email Sent',
        description: 'Confirmation email has been sent. Please check your inbox.',
      });
      return true;
    } catch (error) {
      handleError(error as AuthError);
      return false;
    } finally {
      setErrorLoading(false);
    }
  }, [setErrorLoading, clearError, handleError, toast]);

  const resetPassword = useCallback(async (email: string): Promise<boolean> => {
    setErrorLoading(true);
    clearError();

    try {
      const { error } = await AuthService.resetPassword(email);

      if (error) {
        handleError(error);
        return false;
      }

      toast({
        title: 'Password Reset Sent',
        description: 'Check your email for password reset instructions.',
      });
      return true;
    } catch (error) {
      handleError(error as AuthError);
      return false;
    } finally {
      setErrorLoading(false);
    }
  }, [setErrorLoading, clearError, handleError, toast]);

  const updatePassword = useCallback(async (password: string): Promise<boolean> => {
    setErrorLoading(true);
    clearError();

    try {
      const { error } = await AuthService.updatePassword(password);

      if (error) {
        handleError(error);
        return false;
      }

      toast({
        title: 'Password Updated',
        description: 'Your password has been successfully updated.',
      });
      return true;
    } catch (error) {
      handleError(error as AuthError);
      return false;
    } finally {
      setErrorLoading(false);
    }
  }, [setErrorLoading, clearError, handleError, toast]);

  const updateProfile = useCallback(async (updates: Partial<UserProfile>): Promise<boolean> => {
    if (!user) return false;

    setErrorLoading(true);
    clearError();

    try {
      const { profile: updatedProfile, error } = await UserService.updateProfile(user.id, updates);

      if (error) {
        handleError(error as AuthError, 'Failed to update profile');
        return false;
      }

      if (updatedProfile) {
        setProfile(updatedProfile);
        toast({
          title: 'Profile Updated',
          description: 'Your profile has been successfully updated.',
        });
        return true;
      }

      return false;
    } catch (error) {
      handleError(error as AuthError);
      return false;
    } finally {
      setErrorLoading(false);
    }
  }, [user, setErrorLoading, clearError, handleError, toast]);

  const refreshProfile = useCallback(async (): Promise<void> => {
    if (!user) return;

    try {
      setTimeout(() => { loadUserData(user.id); }, 0);
    } catch (error) {
      logger.auth('Error refreshing profile', { error }, 'error');
    }
  }, [user, loadUserData]);

  const refreshSession = useCallback(async (): Promise<void> => {
    try {
      const { session: newSession, error } = await SessionService.refreshSession();

      if (error) {
        logger.auth('Session refresh error', { error }, 'error');
        return;
      }

      if (newSession) {
        setSession(newSession);
        setUser(newSession.user);
      }
    } catch (error) {
      logger.auth('Session refresh error', { error }, 'error');
    }
  }, []);

  // Enhanced auth state recovery
  const recoverAuthState = useCallback(async (): Promise<boolean> => {
    try {
      ErrorLoggingService.logAuthEvent('recovery_attempt', 'info', {
        operation: 'recoverAuthState',
        component: 'NewAuthContext'
      });

      const result = await AuthStateRecoveryService.recoverAuthState();

      if (result.success && result.newState) {
        if (result.newState.user && result.newState.session) {
          setUser(result.newState.user);
          setSession(result.newState.session);
          setProfile(result.newState.profile);
          setRole(result.newState.role);
        }

        toast({
          title: 'Session Recovered',
          description: result.fallbackUsed ? 'Using guest mode' : 'Your session has been restored.',
        });

        ErrorLoggingService.logAuthEvent('recovery_success', 'info', {
          operation: 'recoverAuthState',
          component: 'NewAuthContext'
        }, {
          method: result.recoveryMethod,
          fallbackUsed: result.fallbackUsed
        });

        return true;
      }

      ErrorLoggingService.logAuthEvent('recovery_failed', 'warn', {
        operation: 'recoverAuthState',
        component: 'NewAuthContext'
      }, { error: result.error?.message });

      return false;
    } catch (error) {
      ErrorLoggingService.logError(error as Error, {
        operation: 'recoverAuthState',
        component: 'NewAuthContext'
      });

      return false;
    }
  }, [toast]);

  // Computed values
  const isAuthenticated = !!user;
  const isEmailVerified = user?.email_confirmed_at != null;
  const isOnboardingComplete = profile?.onboarding_completed || false;
  const isAdmin = role === 'admin';

  const hasRole = useCallback((checkRole: 'admin' | 'user'): boolean => {
    return role === checkRole;
  }, [role]);

  const value: AuthContextType = {
    // Core state
    user,
    session,
    profile,
    role,
    loading,
    initialDataReady,
    dataFetchEnabled,
    spotifyDataFetchEnabled,

    // Auth states
    isAuthenticated,
    isEmailVerified,
    isOnboardingComplete,

    // Auth actions
    signUp,
    signIn,
    signOut,
    resendConfirmation,
    resetPassword,
    updatePassword,

    // Profile actions
    updateProfile,
    refreshProfile,

    // Session actions
    refreshSession,

    // Recovery actions
    recoverAuthState,

    // Role checks
    hasRole,
    isAdmin,

    // Error handling
    error,
    clearError,
    lastErrorContext,
    errorRecoveryAvailable,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
