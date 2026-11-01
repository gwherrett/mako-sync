import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/NewAuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Music2, Loader2, Eye, EyeOff, CheckCircle, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { z } from 'zod';

// Password validation schema
const passwordSchema = z.string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/^(?=.*[a-z])/, 'Password must contain at least one lowercase letter')
  .regex(/^(?=.*[A-Z])/, 'Password must contain at least one uppercase letter')
  .regex(/^(?=.*\d)/, 'Password must contain at least one number');

const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [resetComplete, setResetComplete] = useState(false);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);

  const { updatePassword, error, clearError } = useAuth();

  // Check if we have the required parameters
  const accessToken = searchParams.get('access_token');
  const refreshToken = searchParams.get('refresh_token');
  const type = searchParams.get('type');

  useEffect(() => {
    // Validate that we have the required parameters for password reset
    if (type === 'recovery' && accessToken && refreshToken) {
      setTokenValid(true);
      // Set the session with the tokens from the URL
      // This is handled automatically by Supabase when the user clicks the reset link
    } else {
      setTokenValid(false);
    }
  }, [type, accessToken, refreshToken]);

  useEffect(() => {
    clearError();
  }, [clearError]);

  const validatePasswords = () => {
    const errors: Record<string, string> = {};

    // Validate password strength
    const passwordValidation = passwordSchema.safeParse(password);
    if (!passwordValidation.success) {
      errors.password = passwordValidation.error.issues[0].message;
    }

    // Validate password confirmation
    if (password !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
    }

    if (!confirmPassword) {
      errors.confirmPassword = 'Please confirm your password';
    }

    return errors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    clearError();
    setValidationErrors({});

    try {
      // Validate passwords
      const errors = validatePasswords();
      if (Object.keys(errors).length > 0) {
        setValidationErrors(errors);
        setIsSubmitting(false);
        return;
      }

      // Update password
      const success = await updatePassword(password);
      if (success) {
        setResetComplete(true);
        // Redirect to login after 3 seconds
        setTimeout(() => {
          navigate('/auth');
        }, 3000);
      }
    } catch (error) {
      console.error('Password reset error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Invalid token state
  if (tokenValid === false) {
    return (
      <div className="min-h-screen bg-linear-to-br from-expos-dark via-expos-dark-elevated to-black flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-spotify-dark border-white/10">
          <CardHeader className="text-center">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-red-400" />
            </div>
            <CardTitle className="text-2xl text-white">
              Invalid Reset Link
            </CardTitle>
            <CardDescription className="text-gray-400">
              This password reset link is invalid or has expired
            </CardDescription>
          </CardHeader>
          
          <CardContent>
            <Alert className="mb-4 border-red-500/20 bg-red-500/10">
              <AlertDescription className="text-red-400">
                The password reset link you clicked is either invalid or has expired. Please request a new password reset from the login page.
              </AlertDescription>
            </Alert>
            
            <Button 
              onClick={() => navigate('/auth')}
              className="w-full spotify-gradient text-black font-medium"
            >
              Back to Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Loading state while validating token
  if (tokenValid === null) {
    return (
      <div className="min-h-screen bg-linear-to-br from-expos-dark via-expos-dark-elevated to-black flex items-center justify-center p-4">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-green-400 mx-auto mb-4" />
          <p className="text-gray-400">Validating reset link...</p>
        </div>
      </div>
    );
  }

  // Success state
  if (resetComplete) {
    return (
      <div className="min-h-screen bg-linear-to-br from-expos-dark via-expos-dark-elevated to-black flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-spotify-dark border-white/10">
          <CardHeader className="text-center">
            <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-green-400" />
            </div>
            <CardTitle className="text-2xl text-white">
              Password Reset Complete
            </CardTitle>
            <CardDescription className="text-gray-400">
              Your password has been successfully updated
            </CardDescription>
          </CardHeader>
          
          <CardContent>
            <Alert className="mb-4 border-green-500/20 bg-green-500/10">
              <AlertDescription className="text-green-400">
                Your password has been successfully reset. You will be redirected to the sign-in page shortly.
              </AlertDescription>
            </Alert>
            
            <Button 
              onClick={() => navigate('/auth')}
              className="w-full spotify-gradient text-black font-medium"
            >
              Continue to Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Password reset form
  return (
    <div className="min-h-screen bg-linear-to-br from-expos-dark via-expos-dark-elevated to-black flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-spotify-dark border-white/10">
        <CardHeader className="text-center">
          <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <Music2 className="w-8 h-8 text-black" />
          </div>
          <CardTitle className="text-2xl text-white">
            Set New Password
          </CardTitle>
          <CardDescription className="text-gray-400">
            Enter your new password below
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

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password" className="text-white">
                New Password
                <span className="text-gray-400 text-xs ml-2">
                  (min 8 chars, must include uppercase, lowercase, and number)
                </span>
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className={`bg-white/10 border-white/20 text-white placeholder-gray-400 pr-10 ${validationErrors.password ? 'border-red-500' : ''}`}
                  placeholder="Enter your new password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {validationErrors.password && (
                <p className="text-red-400 text-sm">{validationErrors.password}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-white">
                Confirm New Password
              </Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className={`bg-white/10 border-white/20 text-white placeholder-gray-400 pr-10 ${validationErrors.confirmPassword ? 'border-red-500' : ''}`}
                  placeholder="Confirm your new password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {validationErrors.confirmPassword && (
                <p className="text-red-400 text-sm">{validationErrors.confirmPassword}</p>
              )}
            </div>
            
            <Button 
              type="submit" 
              className="w-full spotify-gradient text-black font-medium"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Updating Password...
                </>
              ) : (
                'Update Password'
              )}
            </Button>
          </form>
          
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => navigate('/auth')}
              className="text-gray-400 hover:text-gray-300 text-sm transition-colors"
            >
              Back to Sign In
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ResetPassword;