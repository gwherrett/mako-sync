/**
 * useSlskdConfig Hook
 *
 * Manages slskd configuration stored in browser localStorage.
 * Provides config state, save/test functionality, and cross-tab sync.
 */

import { useState, useEffect, useCallback } from 'react';
import { SlskdStorageService } from '@/services/slskdStorage.service';
import { SlskdClientService } from '@/services/slskdClient.service';
import type { SlskdConfig, SlskdConnectionResult } from '@/types/slskd';
import { useToast } from '@/hooks/use-toast';

/**
 * The most recent connection test, with the endpoint and key it used, so the
 * UI can hide the result once either field changes.
 */
export interface SlskdConnectionTest {
  apiEndpoint: string;
  apiKey: string;
  result: SlskdConnectionResult;
}

export function useSlskdConfig() {
  const { toast } = useToast();
  const [config, setConfig] = useState<SlskdConfig>(SlskdStorageService.getConfig);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [lastTest, setLastTest] = useState<SlskdConnectionTest | null>(null);

  // Reload config if localStorage changes (e.g., from another tab)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === SlskdStorageService.getStorageKey()) {
        setConfig(SlskdStorageService.getConfig());
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  /**
   * Save configuration and test connection.
   * The config is saved whatever the result; connectionStatus is true only when
   * slskd is connected and logged in to Soulseek.
   */
  const saveConfig = useCallback(async (
    newConfig: Omit<SlskdConfig, 'connectionStatus' | 'lastConnectionTest'>
  ): Promise<SlskdConnectionResult | null> => {
    setIsSaving(true);

    try {
      // Test connection before saving
      const testConfig: SlskdConfig = {
        ...newConfig,
        connectionStatus: false,
        lastConnectionTest: undefined,
      };
      const result = await SlskdClientService.testConnection(testConfig);
      setLastTest({ apiEndpoint: newConfig.apiEndpoint, apiKey: newConfig.apiKey, result });

      const updated = SlskdStorageService.saveConfig({
        ...newConfig,
        connectionStatus: result.status === 'connected',
        lastConnectionTest: new Date().toISOString(),
      });

      setConfig(updated);

      toast({ title: 'slskd configuration saved' });

      return result;
    } catch (error) {
      console.error('Failed to save slskd config:', error);
      toast({
        title: 'Save Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [toast]);

  /**
   * Test connection without saving
   */
  const testConnection = useCallback(async (
    testConfig: Pick<SlskdConfig, 'apiEndpoint' | 'apiKey'>
  ): Promise<SlskdConnectionResult> => {
    setIsTesting(true);

    try {
      const fullConfig: SlskdConfig = {
        ...SlskdStorageService.getConfig(),
        ...testConfig,
      };
      const result = await SlskdClientService.testConnection(fullConfig);
      setLastTest({ apiEndpoint: testConfig.apiEndpoint, apiKey: testConfig.apiKey, result });
      return result;
    } finally {
      setIsTesting(false);
    }
  }, []);

  /**
   * Clear all configuration
   */
  const clearConfig = useCallback(() => {
    SlskdStorageService.clearConfig();
    setConfig(SlskdStorageService.getConfig());
    setLastTest(null);
    toast({
      title: 'Configuration Cleared',
      description: 'slskd configuration has been removed',
    });
  }, [toast]);

  return {
    config,
    isConfigured: SlskdStorageService.isConfigured(),
    isLoading: false, // localStorage is synchronous
    error: null,
    saveConfig,
    clearConfig,
    isSaving,
    testConnection,
    isTesting,
    lastTest,
  };
}
