import { Loader2, Shield, Key, UserCheck, Wifi, WifiOff } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

interface AuthLoadingStatesProps {
  isInitializing?: boolean;
  isAuthenticating?: boolean;
  isRefreshing?: boolean;
  isOnline?: boolean;
  loadingMessage?: string;
  className?: string;
}

export const AuthLoadingStates = ({
  isInitializing = false,
  isAuthenticating = false,
  isRefreshing = false,
  isOnline = true,
  loadingMessage,
  className
}: AuthLoadingStatesProps) => {
  // Don't render if nothing is loading
  if (!isInitializing && !isAuthenticating && !isRefreshing) {
    return null;
  }

  const getLoadingContent = () => {
    if (isInitializing) {
      return {
        icon: Shield,
        title: 'Initializing Security',
        message: loadingMessage || 'Setting up secure authentication...',
        progress: undefined
      };
    }

    if (isAuthenticating) {
      return {
        icon: Key,
        title: 'Authenticating',
        message: loadingMessage || 'Verifying your credentials...',
        progress: undefined
      };
    }

    if (isRefreshing) {
      return {
        icon: UserCheck,
        title: 'Refreshing Session',
        message: loadingMessage || 'Extending your session...',
        progress: undefined
      };
    }

    return {
      icon: Loader2,
      title: 'Loading',
      message: loadingMessage || 'Please wait...',
      progress: undefined
    };
  };

  const { icon: Icon, title, message, progress } = getLoadingContent();

  return (
    <Card className={cn('w-full max-w-md mx-auto', className)}>
      <CardContent className="pt-6">
        <div className="flex flex-col items-center space-y-4">
          {/* Loading icon with connection status */}
          <div className="relative">
            <Icon className="h-8 w-8 animate-spin text-primary" />
            
            {/* Connection indicator */}
            <div className="absolute -bottom-1 -right-1">
              {isOnline ? (
                <Wifi className="h-3 w-3 text-green-500" />
              ) : (
                <WifiOff className="h-3 w-3 text-red-500" />
              )}
            </div>
          </div>

          {/* Loading text */}
          <div className="text-center space-y-2">
            <h3 className="font-semibold text-lg">{title}</h3>
            <p className="text-sm text-muted-foreground">{message}</p>
          </div>

          {/* Progress bar (if provided) */}
          {progress !== undefined && (
            <div className="w-full space-y-2">
              <Progress value={progress} className="w-full" />
              <p className="text-xs text-center text-muted-foreground">
                {Math.round(progress)}% complete
              </p>
            </div>
          )}

          {/* Offline warning */}
          {!isOnline && (
            <div className="w-full p-3 bg-muted rounded-lg">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <WifiOff className="h-4 w-4" />
                <span>Limited functionality while offline</span>
              </div>
            </div>
          )}

          {/* Loading dots animation */}
          <div className="flex space-x-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={cn(
                  'w-2 h-2 bg-primary rounded-full animate-pulse',
                  `animation-delay-${i * 200}`
                )}
                style={{
                  animationDelay: `${i * 0.2}s`,
                  animationDuration: '1.4s'
                }}
              />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

// Overlay version for full-screen loading
export const AuthLoadingOverlay = ({
  isInitializing = false,
  isAuthenticating = false,
  isRefreshing = false,
  isOnline = true,
  loadingMessage,
  className
}: AuthLoadingStatesProps) => {
  // Don't render if nothing is loading
  if (!isInitializing && !isAuthenticating && !isRefreshing) {
    return null;
  }

  return (
    <div className={cn(
      'fixed inset-0 bg-background/80 backdrop-blur-xs z-50 flex items-center justify-center',
      className
    )}>
      <AuthLoadingStates
        isInitializing={isInitializing}
        isAuthenticating={isAuthenticating}
        isRefreshing={isRefreshing}
        isOnline={isOnline}
        loadingMessage={loadingMessage}
      />
    </div>
  );
};

// Inline loading component for smaller spaces
export const AuthLoadingInline = ({
  isAuthenticating = false,
  isRefreshing = false,
  loadingMessage,
  className
}: Omit<AuthLoadingStatesProps, 'isInitializing'>) => {
  if (!isAuthenticating && !isRefreshing) {
    return null;
  }

  const message = loadingMessage || (isAuthenticating ? 'Authenticating...' : 'Refreshing...');

  return (
    <div className={cn('flex items-center gap-2 text-sm text-muted-foreground', className)}>
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>{message}</span>
    </div>
  );
};

export default AuthLoadingStates;