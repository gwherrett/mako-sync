import { useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { User } from '@supabase/supabase-js';

export interface UseAuthRedirectOptions {
  user: User | null;
  loading: boolean;
  redirectTo?: string;
  loginPath?: string;
  allowedRoles?: ('admin' | 'user')[];
  userRole?: 'admin' | 'user' | null;
}

// Placeholder origin used only to resolve a candidate path; never navigated to.
const RETURN_TO_BASE = 'http://return-to.invalid';

/**
 * Returns `value` as a same-origin, app-relative path, or `fallback` if it isn't one.
 * Rejects protocol-relative ("//host"), backslash ("/\host", "\host") and scheme
 * ("https:", "javascript:") values, which would send the user off the app after login.
 */
export const getSafeReturnTo = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string' || !value.startsWith('/')) return fallback;
  try {
    // The URL parser strips tabs/newlines and treats "\" as "/", the same way the browser would
    const url = new URL(value, RETURN_TO_BASE);
    if (url.origin !== RETURN_TO_BASE) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
};

export const useAuthRedirect = ({
  user,
  loading,
  redirectTo = '/',
  loginPath = '/auth',
  allowedRoles,
  userRole
}: UseAuthRedirectOptions) => {
  const navigate = useNavigate();
  const location = useLocation();

  const redirectToLogin = useCallback(() => {
    // Store the attempted URL for redirect after login. The pathname comes from the
    // address bar, so a link like https://app//evil.com yields "//evil.com"
    const returnTo = location.pathname !== loginPath
      ? getSafeReturnTo(location.pathname, redirectTo)
      : redirectTo;
    navigate(loginPath, { 
      state: { returnTo },
      replace: true 
    });
  }, [navigate, location.pathname, loginPath, redirectTo]);

  const redirectToDestination = useCallback(() => {
    // Check if there's a return URL from login. Validate again here: history state
    // can be set by any code that navigates to the login page
    const returnTo = getSafeReturnTo(
      (location.state as { returnTo?: unknown } | null)?.returnTo,
      redirectTo
    );
    navigate(returnTo, { replace: true });
  }, [navigate, location.state, redirectTo]);

  const checkRoleAccess = useCallback((requiredRoles?: ('admin' | 'user')[]) => {
    if (!requiredRoles || requiredRoles.length === 0) return true;
    if (!userRole) return false;
    
    return requiredRoles.includes(userRole);
  }, [userRole]);

  useEffect(() => {
    console.log('🔄 REDIRECT DEBUG: useAuthRedirect effect triggered', {
      hasUser: !!user,
      loading,
      currentPath: location.pathname,
      loginPath,
      allowedRoles,
      userRole,
      timestamp: new Date().toISOString()
    });

    // Don't redirect while loading
    if (loading) {
      console.log('⏳ REDIRECT DEBUG: Skipping redirect - still loading');
      return;
    }

    // If user is not authenticated and not on login page, redirect to login
    if (!user && location.pathname !== loginPath) {
      console.log('🔐 REDIRECT DEBUG: User not authenticated, redirecting to login', {
        from: location.pathname,
        to: loginPath
      });
      redirectToLogin();
      return;
    }

    // If user is authenticated and on login page, redirect to main app
    if (user && location.pathname === loginPath) {
      console.log('✅ REDIRECT DEBUG: User authenticated on login page, redirecting to app', {
        userId: user.id,
        from: loginPath,
        returnTo: getSafeReturnTo((location.state as { returnTo?: unknown } | null)?.returnTo, redirectTo)
      });
      redirectToDestination();
      return;
    }

    // Check role-based access
    if (user && allowedRoles && !checkRoleAccess(allowedRoles)) {
      console.log('🚫 REDIRECT DEBUG: User lacks required role, redirecting to home', {
        userId: user.id,
        userRole,
        requiredRoles: allowedRoles
      });
      // Redirect to unauthorized page or main page
      navigate('/', { replace: true });
      return;
    }

    console.log('✅ REDIRECT DEBUG: No redirect needed - user in correct state');
  }, [
    user,
    loading,
    location.pathname,
    loginPath,
    allowedRoles,
    redirectToLogin,
    redirectToDestination,
    checkRoleAccess,
    navigate
  ]);

  return {
    redirectToLogin,
    redirectToDestination,
    checkRoleAccess,
    isAuthenticated: !!user,
    hasRoleAccess: checkRoleAccess(allowedRoles)
  };
};