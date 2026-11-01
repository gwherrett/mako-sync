import React from 'react';
import { useAuth } from '@/contexts/NewAuthContext';
import { useAuthRedirect } from '@/hooks/useAuthRedirect';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: ('admin' | 'user')[];
  requireEmailVerification?: boolean;
  requireOnboarding?: boolean;
}

const NewProtectedRoute: React.FC<ProtectedRouteProps> = ({ 
  children, 
  allowedRoles,
  requireEmailVerification = false,
  requireOnboarding = false
}) => {
  const { 
    user, 
    loading, 
    role, 
    isEmailVerified,
    isOnboardingComplete 
  } = useAuth();

  const { isAuthenticated, hasRoleAccess } = useAuthRedirect({
    user,
    loading,
    allowedRoles,
    userRole: role
  });

  // Show loading spinner while auth is loading
  if (loading) {
    return (
      <div className="min-h-screen bg-linear-to-br from-expos-dark via-expos-dark-elevated to-black flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-green-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-white mb-2">Loading...</h2>
          <p className="text-gray-400">Please wait while we verify your authentication.</p>
        </div>
      </div>
    );
  }

  // Check authentication (handled by useAuthRedirect)
  if (!isAuthenticated) {
    return null; // useAuthRedirect will handle the redirect
  }

  // Check role access
  if (allowedRoles && !hasRoleAccess) {
    return (
      <div className="min-h-screen bg-linear-to-br from-expos-dark via-expos-dark-elevated to-black flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-8">
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Loader2 className="w-8 h-8 text-red-400" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Access Denied</h2>
          <p className="text-gray-400 mb-4">
            You don't have permission to access this page.
          </p>
          <p className="text-sm text-gray-500">
            Required roles: {allowedRoles?.join(', ')}
          </p>
        </div>
      </div>
    );
  }

  // Check email verification
  if (requireEmailVerification && !isEmailVerified) {
    return (
      <div className="min-h-screen bg-linear-to-br from-expos-dark via-expos-dark-elevated to-black flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-8">
          <div className="w-16 h-16 bg-yellow-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Loader2 className="w-8 h-8 text-yellow-400" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Email Verification Required</h2>
          <p className="text-gray-400 mb-4">
            Please verify your email address to continue.
          </p>
          <p className="text-sm text-gray-500">
            Check your inbox for a verification email.
          </p>
        </div>
      </div>
    );
  }

  // Check onboarding completion
  if (requireOnboarding && !isOnboardingComplete) {
    return (
      <div className="min-h-screen bg-linear-to-br from-expos-dark via-expos-dark-elevated to-black flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-8">
          <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Loader2 className="w-8 h-8 text-blue-400" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Complete Setup</h2>
          <p className="text-gray-400 mb-4">
            Please complete your account setup to continue.
          </p>
        </div>
      </div>
    );
  }

  // All checks passed, render children
  return <>{children}</>;
};

export default NewProtectedRoute;