import { useState, useCallback, useEffect, useRef } from 'react';
import { AuthError } from '@supabase/supabase-js';
import { useToast } from '@/hooks/use-toast';
import { ErrorHandlingService, ErrorContext, ErrorHandlingResult } from '@/services/errorHandling.service';
import { ErrorLoggingService } from '@/services/errorLogging.service';
import { AuthRetryService } from '@/services/authRetry.service';
import { AuthStateRecoveryService } from '@/services/authStateRecovery.service';

export interface EnhancedErrorState {
  error: Error | AuthError | null;
  isLoading: boolean;
  hasError: boolean;
  errorContext: ErrorContext | null;
  errorResult: ErrorHandlingResult | null;
  canRetry: boolean;
  canRecover: boolean;
  retryCount: number;
  lastRetryTime: Date | null;
}

export interface EnhancedErrorActions {
  handleError: (error: Error | AuthError, context?: Partial<ErrorContext>) => Promise<void>;
  retryLastOperation: () => Promise<boolean>;
  recoverState: () => Promise<boolean>;
  clearError: () => void;
  setLoading: (loading: boolean) => void;
  executeWithErrorHandling: <T>(
    operation: () => Promise<T>,
    context?: Partial<ErrorContext>
  ) => Promise<T | null>;
}

export interface ErrorHandlingConfig {
  enableAutoRetry: boolean;
  enableAutoRecovery: boolean;
  maxAutoRetries: number;
  showToastNotifications: boolean;
  logErrors: boolean;
  retryDelay: number;
}

export const useEnhancedErrorHandling = (
  config: Partial<ErrorHandlingConfig> = {}
): EnhancedErrorState & EnhancedErrorActions => {
  const defaultConfig: ErrorHandlingConfig = {
    enableAutoRetry: true,
    enableAutoRecovery: true,
    maxAutoRetries: 3,
    showToastNotifications: true,
    logErrors: true,
    retryDelay: 1000
  };

  const finalConfig = { ...defaultConfig, ...config };
  const { toast } = useToast();

  // State
  const [error, setError] = useState<Error | AuthError | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorContext, setErrorContext] = useState<ErrorContext | null>(null);
  const [errorResult, setErrorResult] = useState<ErrorHandlingResult | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [lastRetryTime, setLastRetryTime] = useState<Date | null>(null);

  // Refs for operation tracking
  const lastOperationRef = useRef<(() => Promise<unknown>) | null>(null);
  const lastContextRef = useRef<Partial<ErrorContext> | null>(null);

  // Clear error state (defined early to avoid hoisting issues)
  const clearError = useCallback(() => {
    setError(null);
    setErrorContext(null);
    setErrorResult(null);
    setRetryCount(0);
    setLastRetryTime(null);
    lastOperationRef.current = null;
    lastContextRef.current = null;
  }, []);

  // Computed state
  const hasError = !!error;
  const canRetry = errorResult?.shouldRetry && retryCount < finalConfig.maxAutoRetries;
  const canRecover = errorResult?.requiresReauth || (hasError && !canRetry);

  // Handle error with comprehensive processing
  const handleError = useCallback(async (
    err: Error | AuthError,
    context: Partial<ErrorContext> = {}
  ): Promise<void> => {
    const fullContext: ErrorContext = {
      operation: 'unknown',
      component: 'useEnhancedErrorHandling',
      timestamp: new Date(),
      userAgent: navigator.userAgent,
      url: window.location.href,
      ...context
    };

    // Process error through our enhanced error handling service
    const result = ErrorHandlingService.handleError(err, fullContext);

    // Update state
    setError(err);
    setErrorContext(fullContext);
    setErrorResult(result);

    // Log error if enabled
    if (finalConfig.logErrors) {
      ErrorLoggingService.logError(err, fullContext);
    }

    // Show toast notification if enabled
    if (finalConfig.showToastNotifications) {
      toast({
        title: 'Error',
        description: result.userMessage,
        variant: 'destructive',
      });
    }

    // Auto-retry if enabled and conditions are met
    if (finalConfig.enableAutoRetry && result.shouldRetry && retryCount < finalConfig.maxAutoRetries) {
      setTimeout(() => {
        retryLastOperation();
      }, result.retryDelay || finalConfig.retryDelay);
    }

    // Auto-recovery if enabled and required
    if (finalConfig.enableAutoRecovery && result.requiresReauth) {
      setTimeout(() => {
        recoverState();
      }, 2000); // Wait 2 seconds before attempting recovery
    }
  }, [finalConfig, toast, retryCount, clearError]);

  // Retry last operation
  const retryLastOperation = useCallback(async (): Promise<boolean> => {
    if (!lastOperationRef.current || !canRetry) {
      return false;
    }

    setIsLoading(true);
    setRetryCount(prev => prev + 1);
    setLastRetryTime(new Date());

    try {
      ErrorLoggingService.logAuthEvent('retry_attempt', 'info', {
        operation: lastContextRef.current?.operation || 'unknown',
        component: 'useEnhancedErrorHandling'
      }, { retryCount: retryCount + 1 });

      await lastOperationRef.current();
      
      // Success - clear error state
      clearError();
      
      ErrorLoggingService.logAuthEvent('retry_success', 'info', {
        operation: lastContextRef.current?.operation || 'unknown',
        component: 'useEnhancedErrorHandling'
      }, { retryCount: retryCount + 1 });

      if (finalConfig.showToastNotifications) {
        toast({
          title: 'Success',
          description: 'Operation completed successfully after retry.',
        });
      }

      return true;
    } catch (retryError) {
      await handleError(retryError as Error, {
        ...lastContextRef.current,
        operation: `${lastContextRef.current?.operation || 'unknown'}_retry`,
        additionalData: { retryAttempt: retryCount + 1 }
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [canRetry, retryCount, handleError, clearError, finalConfig, toast]);

  // Recover authentication state
  const recoverState = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);

    try {
      ErrorLoggingService.logAuthEvent('state_recovery_attempt', 'info', {
        operation: 'recoverState',
        component: 'useEnhancedErrorHandling'
      });

      const result = await AuthStateRecoveryService.recoverAuthState();

      if (result.success) {
        clearError();
        
        ErrorLoggingService.logAuthEvent('state_recovery_success', 'info', {
          operation: 'recoverState',
          component: 'useEnhancedErrorHandling'
        }, { 
          method: result.recoveryMethod,
          fallbackUsed: result.fallbackUsed 
        });

        if (finalConfig.showToastNotifications) {
          toast({
            title: 'State Recovered',
            description: result.fallbackUsed 
              ? 'Switched to guest mode' 
              : 'Your session has been restored.',
          });
        }

        return true;
      } else {
        ErrorLoggingService.logAuthEvent('state_recovery_failed', 'error', {
          operation: 'recoverState',
          component: 'useEnhancedErrorHandling'
        }, { error: result.error?.message });

        if (finalConfig.showToastNotifications) {
          toast({
            title: 'Recovery Failed',
            description: 'Unable to recover your session. Please sign in again.',
            variant: 'destructive',
          });
        }

        return false;
      }
    } catch (recoveryError) {
      ErrorLoggingService.logError(recoveryError as Error, {
        operation: 'recoverState',
        component: 'useEnhancedErrorHandling'
      });

      return false;
    } finally {
      setIsLoading(false);
    }
  }, [clearError, finalConfig, toast]);

  // Set loading state
  const setLoadingState = useCallback((loading: boolean) => {
    setIsLoading(loading);
  }, []);

  // Execute operation with comprehensive error handling
  const executeWithErrorHandling = useCallback(async <T>(
    operation: () => Promise<T>,
    context: Partial<ErrorContext> = {}
  ): Promise<T | null> => {
    // Store operation for potential retry
    lastOperationRef.current = operation;
    lastContextRef.current = context;

    setIsLoading(true);
    clearError();

    try {
      const result = await operation();
      
      // Log successful operation
      if (finalConfig.logErrors) {
        ErrorLoggingService.logAuthEvent('operation_success', 'info', {
          operation: context.operation || 'unknown',
          component: context.component || 'useEnhancedErrorHandling'
        });
      }

      return result;
    } catch (err) {
      await handleError(err as Error, context);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [handleError, clearError, finalConfig]);

  // Auto-recovery check on mount
  useEffect(() => {
    if (finalConfig.enableAutoRecovery) {
      AuthStateRecoveryService.autoRecover().then(result => {
        if (result && !result.success) {
          console.warn('Auto-recovery failed:', result.error);
        }
      });
    }
  }, [finalConfig.enableAutoRecovery]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearError();
    };
  }, [clearError]);

  return {
    // State
    error,
    isLoading,
    hasError,
    errorContext,
    errorResult,
    canRetry,
    canRecover,
    retryCount,
    lastRetryTime,

    // Actions
    handleError,
    retryLastOperation,
    recoverState,
    clearError,
    setLoading: setLoadingState,
    executeWithErrorHandling,
  };
};

export default useEnhancedErrorHandling;