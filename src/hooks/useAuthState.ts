import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/NewAuthContext';

interface AuthStateConfig {
  showLoadingStates?: boolean;
  sessionTimeoutWarning?: number; // minutes before session expires to show warning
  autoRefresh?: boolean;
}

interface AuthState {
  // Loading states
  isInitializing: boolean;
  isAuthenticating: boolean;
  isRefreshing: boolean;
  
  // Session states
  sessionTimeRemaining: number | null;
  showSessionWarning: boolean;
  isSessionExpired: boolean;
  
  // Connection states
  isOnline: boolean;
  lastActivity: Date | null;
  
  // Actions
  refreshSession: () => Promise<void>;
  extendSession: () => void;
  handleActivity: () => void;
}

export const useAuthState = (config: AuthStateConfig = {}): AuthState => {
  const {
    showLoadingStates = true,
    sessionTimeoutWarning = 5, // 5 minutes warning
    autoRefresh = true,
  } = config;

  const { 
    user, 
    session, 
    loading, 
    refreshSession: contextRefreshSession 
  } = useAuth();

  // Loading states
  const [isInitializing, setIsInitializing] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Session states
  const [sessionTimeRemaining, setSessionTimeRemaining] = useState<number | null>(null);
  const [showSessionWarning, setShowSessionWarning] = useState(false);
  const [isSessionExpired, setIsSessionExpired] = useState(false);
  const [lastActivity, setLastActivity] = useState<Date | null>(null);

  // Connection state
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Handle initialization
  useEffect(() => {
    if (!loading) {
      setIsInitializing(false);
    }
  }, [loading]);

  // Handle session timing with optimized updates
  useEffect(() => {
    if (!session?.expires_at) return;

    const updateSessionTime = () => {
      const expiresAt = new Date(session.expires_at! * 1000);
      const now = new Date();
      const timeRemaining = Math.max(0, expiresAt.getTime() - now.getTime());
      const minutesRemaining = Math.floor(timeRemaining / (1000 * 60));
      
      // Only update state if values actually changed to prevent unnecessary re-renders
      setSessionTimeRemaining(prev => prev !== minutesRemaining ? minutesRemaining : prev);

      // Show warning if session is expiring soon
      const shouldShowWarning = minutesRemaining <= sessionTimeoutWarning && minutesRemaining > 0;
      setShowSessionWarning(prev => prev !== shouldShowWarning ? shouldShowWarning : prev);

      // Mark as expired if time is up
      const isExpired = minutesRemaining <= 0;
      setIsSessionExpired(prev => prev !== isExpired ? isExpired : prev);
    };

    // Update immediately
    updateSessionTime();

    // Use dynamic interval timing - more frequent when close to expiry
    const getIntervalTime = () => {
      const expiresAt = new Date(session.expires_at! * 1000);
      const timeRemaining = Math.max(0, expiresAt.getTime() - Date.now());
      const minutesRemaining = Math.floor(timeRemaining / (1000 * 60));
      
      // Update every 10 seconds when within warning threshold, otherwise every 2 minutes
      return minutesRemaining <= sessionTimeoutWarning ? 10000 : 120000;
    };

    let timeoutId: NodeJS.Timeout;
    
    const scheduleNextUpdate = () => {
      const intervalTime = getIntervalTime();
      timeoutId = setTimeout(() => {
        updateSessionTime();
        scheduleNextUpdate();
      }, intervalTime);
    };

    scheduleNextUpdate();

    return () => clearTimeout(timeoutId);
  }, [session?.expires_at, sessionTimeoutWarning]);

  // Auto-refresh session when warning appears
  useEffect(() => {
    if (showSessionWarning && autoRefresh && !isRefreshing) {
      refreshSession();
    }
  }, [showSessionWarning, autoRefresh, isRefreshing]);

  // Handle online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Track user activity
  const handleActivity = useCallback(() => {
    setLastActivity(new Date());
    
    // Reset session expired state if user is active and we have a valid session
    if (isSessionExpired && session && user) {
      setIsSessionExpired(false);
    }
  }, [isSessionExpired, session, user]);

  // Set up activity tracking
  useEffect(() => {
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    
    const throttledHandleActivity = throttle(handleActivity, 30000); // Throttle to once per 30 seconds

    events.forEach(event => {
      document.addEventListener(event, throttledHandleActivity, true);
    });

    return () => {
      events.forEach(event => {
        document.removeEventListener(event, throttledHandleActivity, true);
      });
    };
  }, [handleActivity]);

  // Enhanced refresh session
  const refreshSession = useCallback(async () => {
    if (isRefreshing) return;

    setIsRefreshing(true);
    try {
      await contextRefreshSession();
      setShowSessionWarning(false);
      setIsSessionExpired(false);
    } catch (error) {
      console.error('Failed to refresh session:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, contextRefreshSession]);

  // Extend session (manual refresh)
  const extendSession = useCallback(() => {
    refreshSession();
  }, [refreshSession]);

  return {
    // Loading states
    isInitializing,
    isAuthenticating,
    isRefreshing,
    
    // Session states
    sessionTimeRemaining,
    showSessionWarning,
    isSessionExpired,
    
    // Connection states
    isOnline,
    lastActivity,
    
    // Actions
    refreshSession,
    extendSession,
    handleActivity,
  };
};

// Utility function for throttling
function throttle<T extends (...args: never[]) => unknown>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  return function (this: unknown, ...args: Parameters<T>) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

export default useAuthState;