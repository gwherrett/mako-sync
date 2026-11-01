import { useState, useEffect, memo, useCallback } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Clock, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SessionTimeoutWarningProps {
  timeRemaining: number; // minutes
  isRefreshing: boolean;
  isOnline: boolean;
  onExtendSession: () => void;
  onDismiss?: () => void;
  className?: string;
}

const SessionTimeoutWarningComponent = ({
  timeRemaining,
  isRefreshing,
  isOnline,
  onExtendSession,
  onDismiss,
  className
}: SessionTimeoutWarningProps) => {
  const [dismissed, setDismissed] = useState(false);

  // Auto-dismiss if session is extended
  useEffect(() => {
    if (timeRemaining > 5) {
      setDismissed(false);
    }
  }, [timeRemaining]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    onDismiss?.();
  }, [onDismiss]);

  const handleExtend = useCallback(() => {
    onExtendSession();
    setDismissed(true);
  }, [onExtendSession]);

  // Don't show if dismissed or time remaining is more than 5 minutes
  // MOVED AFTER ALL HOOKS to prevent "Rendered fewer hooks than expected" error
  if (dismissed || timeRemaining > 5) {
    return null;
  }

  // Calculate progress (5 minutes = 100%, 0 minutes = 0%)
  const progressValue = Math.max(0, (timeRemaining / 5) * 100);

  // Determine alert variant based on time remaining
  const getAlertVariant = () => {
    if (timeRemaining <= 1) return 'destructive';
    if (timeRemaining <= 2) return 'default';
    return 'default';
  };

  const getAlertMessage = () => {
    if (timeRemaining <= 0) {
      return 'Your session has expired. Please sign in again.';
    }
    if (timeRemaining === 1) {
      return 'Your session will expire in 1 minute.';
    }
    return `Your session will expire in ${timeRemaining} minutes.`;
  };

  return (
    <Alert 
      variant={getAlertVariant()}
      className={cn(
        'fixed top-4 right-4 w-96 z-50 shadow-lg border-2',
        timeRemaining <= 1 && 'animate-pulse',
        className
      )}
    >
      <div className="flex items-start gap-3">
        <Clock className="h-4 w-4 mt-0.5 shrink-0" />
        <div className="flex-1 space-y-3">
          <div className="flex items-center justify-between">
            <AlertDescription className="text-sm font-medium">
              {getAlertMessage()}
            </AlertDescription>
            <div className="flex items-center gap-1">
              {isOnline ? (
                <Wifi className="h-3 w-3 text-green-500" />
              ) : (
                <WifiOff className="h-3 w-3 text-red-500" />
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div className="space-y-1">
            <Progress 
              value={progressValue} 
              className={cn(
                'h-2',
                timeRemaining <= 1 && 'bg-red-100',
                timeRemaining <= 2 && 'bg-yellow-100'
              )}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Session expires soon</span>
              <span>{timeRemaining}m remaining</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleExtend}
              disabled={isRefreshing || !isOnline}
              className="flex items-center gap-1"
            >
              {isRefreshing ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {isRefreshing ? 'Extending...' : 'Extend Session'}
            </Button>
            
            <Button
              size="sm"
              variant="ghost"
              onClick={handleDismiss}
              className="text-xs"
            >
              Dismiss
            </Button>
          </div>

          {/* Offline warning */}
          {!isOnline && (
            <div className="text-xs text-muted-foreground bg-muted p-2 rounded">
              <WifiOff className="h-3 w-3 inline mr-1" />
              You're offline. Session extension requires internet connection.
            </div>
          )}
        </div>
      </div>
    </Alert>
  );
};

// Memoize component to prevent unnecessary re-renders
export const SessionTimeoutWarning = memo(SessionTimeoutWarningComponent);

export default SessionTimeoutWarning;