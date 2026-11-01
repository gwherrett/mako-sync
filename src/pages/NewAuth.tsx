import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/NewAuthContext';
import { useAuthRedirect } from '@/hooks/useAuthRedirect';
import { useRealTimeValidation } from '@/hooks/useRealTimeValidation';
import { useAuthState } from '@/hooks/useAuthState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PasswordStrength } from '@/components/ui/password-strength';
import { AuthLoadingInline } from '@/components/auth/AuthLoadingStates';
import { Music2, Loader2, Eye, EyeOff, Mail, ArrowLeft, CheckCircle, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { z } from 'zod';

// Enhanced validation schemas
const emailSchema = z.string()
  .trim()
  .min(1, 'Email is required')
  .email('Please enter a valid email address')
  .max(255, 'Email address is too long')
  .refine(
    (email) => {
      // Basic domain validation
      const domain = email.split('@')[1];
      return domain && domain.includes('.') && domain.length > 3;
    },
    'Please enter a valid email domain'
  );

const passwordSchema = z.string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/^(?=.*[a-z])/, 'Password must contain at least one lowercase letter')
  .regex(/^(?=.*[A-Z])/, 'Password must contain at least one uppercase letter')
  .regex(/^(?=.*\d)/, 'Password must contain at least one number')
  .regex(/^(?=.*[!@#$%^&*(),.?":{}|<>])/, 'Password must contain at least one special character');

const loginPasswordSchema = z.string()
  .min(6, 'Password must be at least 6 characters');

const displayNameSchema = z.string()
  .trim()
  .max(100, 'Display name is too long')
  .refine(
    (name) => !name || name.length >= 2,
    'Display name must be at least 2 characters if provided'
  )
  .optional();

// Real-time validation schemas
const getValidationSchemas = (isLogin: boolean) => ({
  email: emailSchema,
  password: isLogin ? loginPasswordSchema : passwordSchema,
  displayName: displayNameSchema,
});

const NewAuth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [isPasswordReset, setIsPasswordReset] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showResendConfirmation, setShowResendConfirmation] = useState(false);
  const [passwordResetSent, setPasswordResetSent] = useState(false);
  const [showPasswordStrength, setShowPasswordStrength] = useState(false);

  // STRIPPED VERSION: No validation, just basic state
  const [email, setEmail] = useState('gwherrett@gmail.com');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  // Authentication state management
  const authState = useAuthState({
    showLoadingStates: true,
    sessionTimeoutWarning: 5,
    autoRefresh: false, // Don't auto-refresh on auth page
  });

  const {
    user,
    loading,
    isAuthenticated,
    isEmailVerified,
    signUp,
    signIn,
    resendConfirmation,
    resetPassword,
    error,
    clearError
  } = useAuth();

  // Redirect authenticated users
  useAuthRedirect({
    user,
    loading,
    redirectTo: '/',
    loginPath: '/auth'
  });

  useEffect(() => {
    // Clear error when switching between login/signup
    clearError();
    // Reset form data when switching modes
    setEmail('');
    setPassword('');
    setDisplayName('');
    setShowPasswordStrength(false);
  }, [isLogin, clearError]);

  // Show password strength when user starts typing password in signup mode
  useEffect(() => {
    if (!isLogin && password) {
      setShowPasswordStrength(true);
    } else {
      setShowPasswordStrength(false);
    }
  }, [isLogin, password]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    clearError();

    try {
      // Basic validation - just check if fields are not empty
      if (!email || !password || (!isLogin && !displayName)) {
        setIsSubmitting(false);
        return;
      }

      // Sanitize inputs
      const sanitizedEmail = email.trim().toLowerCase();
      const sanitizedDisplayName = displayName.trim();

      if (isLogin) {
        const success = await signIn({
          email: sanitizedEmail,
          password: password
        });
        if (success) {
          // Redirect will be handled by useAuthRedirect
        } else {
          // Check if the error is related to email confirmation
          if (error?.message?.includes('Email not confirmed')) {
            setShowResendConfirmation(true);
          }
        }
      } else {
        const success = await signUp({
          email: sanitizedEmail,
          password: password,
          displayName: sanitizedDisplayName || undefined
        });
        if (success) {
          setIsLogin(true);
          setEmail('');
          setPassword('');
          setDisplayName('');
        }
      }
    } catch (error) {
      // Don't log sensitive auth details
      console.error('Authentication failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendConfirmation = async () => {
    setIsSubmitting(true);
    try {
      await resendConfirmation(email);
      setShowResendConfirmation(false);
    } catch (error) {
      console.error('Resend confirmation error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setEmail('');
    setPassword('');
    setDisplayName('');
    setShowPassword(false);
    setShowResendConfirmation(false);
    setPasswordResetSent(false);
    setShowPasswordStrength(false);
    clearError();
  };

  const handlePasswordReset = async () => {
    if (!email) {
      return;
    }

    setIsSubmitting(true);
    clearError();

    try {
      const success = await resetPassword(email.trim().toLowerCase());
      if (success) {
        setPasswordResetSent(true);
      }
    } catch (error) {
      console.error('Password reset error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBackToLogin = () => {
    setIsPasswordReset(false);
    setPasswordResetSent(false);
    resetForm();
  };

  const switchMode = () => {
    setIsLogin(!isLogin);
    setIsPasswordReset(false);
    resetForm();
  };

  // ValidatedInput component removed - using simple inputs now

  // Show loading while auth state is being determined
  if (loading || authState.isInitializing) {
    return (
      <div className="min-h-screen bg-linear-to-br from-expos-dark via-expos-dark-elevated to-black flex items-center justify-center p-4">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-green-400 mx-auto mb-4" />
          <p className="text-gray-400">
            {authState.isInitializing ? 'Initializing security...' : 'Loading...'}
          </p>
          {!authState.isOnline && (
            <p className="text-red-400 text-sm mt-2">
              You're offline. Some features may be limited.
            </p>
          )}
        </div>
      </div>
    );
  }

  // Show email verification notice for unverified users
  if (isAuthenticated && !isEmailVerified) {
    return (
      <div className="min-h-screen bg-linear-to-br from-expos-dark via-expos-dark-elevated to-black flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-spotify-dark border-white/10">
          <CardHeader className="text-center">
            <div className="w-16 h-16 bg-yellow-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <Mail className="w-8 h-8 text-yellow-400" />
            </div>
            <CardTitle className="text-2xl text-white">
              Verify Your Email
            </CardTitle>
            <CardDescription className="text-gray-400">
              We've sent a verification link to {user?.email}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertDescription className="text-gray-300">
                Please check your email and click the verification link to complete your account setup.
              </AlertDescription>
            </Alert>
            
            <div className="flex flex-col space-y-2">
              <Button 
                onClick={() => resendConfirmation(user?.email || '')}
                variant="outline"
                className="w-full bg-white/10 border-white/20 text-white hover:bg-white/20"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  'Resend Verification Email'
                )}
              </Button>
              
              <Button 
                onClick={() => window.location.reload()}
                variant="ghost"
                className="w-full text-gray-400 hover:text-white"
              >
                I've verified my email
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Password reset flow
  if (isPasswordReset) {
    return (
      <div className="min-h-screen bg-linear-to-br from-expos-dark via-expos-dark-elevated to-black flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-spotify-dark border-white/10">
          <CardHeader className="text-center">
            <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <Mail className="w-8 h-8 text-blue-400" />
            </div>
            <CardTitle className="text-2xl text-white">
              {passwordResetSent ? 'Check Your Email' : 'Reset Password'}
            </CardTitle>
            <CardDescription className="text-gray-400">
              {passwordResetSent
                ? 'We\'ve sent password reset instructions to your email'
                : 'Enter your email address to reset your password'
              }
            </CardDescription>
          </CardHeader>
          
          <CardContent>
            {passwordResetSent ? (
              <div className="space-y-4">
                <Alert className="border-green-500/20 bg-green-500/10">
                  <AlertDescription className="text-green-400">
                    Password reset email sent successfully! Please check your inbox and follow the instructions to reset your password.
                  </AlertDescription>
                </Alert>
                
                <div className="space-y-2">
                  <Button
                    onClick={handleBackToLogin}
                    variant="outline"
                    className="w-full bg-white/10 border-white/20 text-white hover:bg-white/20"
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Sign In
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {error && (
                  <Alert className="mb-4 border-red-500/20 bg-red-500/10">
                    <AlertDescription className="text-red-400">
                      {error.message}
                    </AlertDescription>
                  </Alert>
                )}

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-white">Email Address *</Label>
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Enter your email address"
                      className="bg-white/10 border-white/20 text-white placeholder-gray-400"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Button
                      onClick={handlePasswordReset}
                      className="w-full spotify-gradient text-black font-medium"
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Sending Reset Email...
                        </>
                      ) : (
                        'Send Reset Email'
                      )}
                    </Button>
                    
                    <Button
                      onClick={handleBackToLogin}
                      variant="ghost"
                      className="w-full text-gray-400 hover:text-white"
                      disabled={isSubmitting}
                    >
                      <ArrowLeft className="w-4 h-4 mr-2" />
                      Back to Sign In
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-linear-to-br from-expos-dark via-expos-dark-elevated to-black flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-spotify-dark border-white/10">
        <CardHeader className="text-center">
          <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <Music2 className="w-8 h-8 text-black" />
          </div>
          <CardTitle className="text-2xl text-white">
            {isLogin ? 'Welcome Back' : 'Create Account'}
          </CardTitle>
          <CardDescription className="text-gray-400">
            {isLogin
              ? 'Sign in to access your music library'
              : 'Join us to start syncing your music'
            }
          </CardDescription>
        </CardHeader>
        
        <CardContent>
          {error && (
            <Alert className="mb-4 border-red-500/20 bg-red-500/10">
              <AlertDescription className="text-red-400">
                {error.message}
              </AlertDescription>
            </Alert>
          )}

          {showResendConfirmation && (
            <Alert className="mb-4 border-yellow-500/20 bg-yellow-500/10">
              <AlertDescription className="text-yellow-400 space-y-2">
                <p>Your email address needs to be verified.</p>
                <Button 
                  onClick={handleResendConfirmation}
                  variant="outline"
                  size="sm"
                  className="bg-yellow-500/20 border-yellow-500/40 text-yellow-300 hover:bg-yellow-500/30"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    'Resend verification email'
                  )}
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div className="space-y-2">
                <Label className="text-white">Display Name (Optional)</Label>
                <Input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Enter your display name"
                  className="bg-white/10 border-white/20 text-white placeholder-gray-400"
                />
              </div>
            )}
            
            <div className="space-y-2">
              <Label className="text-white">Email *</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                className="bg-white/10 border-white/20 text-white placeholder-gray-400"
              />
            </div>
            
            <div className="space-y-2">
              <Label className="text-white">Password *</Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="bg-white/10 border-white/20 text-white placeholder-gray-400"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Password strength indicator for signup */}
            {showPasswordStrength && (
              <PasswordStrength
                password={password}
                className="mt-3"
              />
            )}
            
            <Button
              type="submit"
              className="w-full spotify-gradient text-black font-medium"
              disabled={isSubmitting || !authState.isOnline}
            >
              {isSubmitting ? (
                <AuthLoadingInline
                  isAuthenticating={true}
                  loadingMessage={isLogin ? 'Signing in...' : 'Creating account...'}
                  className="text-black"
                />
              ) : !authState.isOnline ? (
                'Offline - Cannot authenticate'
              ) : (
                isLogin ? 'Sign In' : 'Create Account'
              )}
            </Button>
          </form>
          
          <div className="mt-6 text-center space-y-2">
            <button
              type="button"
              onClick={switchMode}
              className="text-green-400 hover:text-green-300 text-sm transition-colors"
            >
              {isLogin 
                ? "Don't have an account? Sign up" 
                : "Already have an account? Sign in"
              }
            </button>
            
            {isLogin && (
              <div>
                <button
                  type="button"
                  onClick={() => setIsPasswordReset(true)}
                  className="text-gray-400 hover:text-gray-300 text-xs transition-colors"
                >
                  Forgot your password?
                </button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default NewAuth;