/**
 * Storage Manager Service
 * 
 * Unified service for managing browser storage contamination and isolation.
 * Addresses critical storage issues identified in the audit:
 * 
 * IDENTIFIED STORAGE KEYS:
 * 1. Authentication: sb-bzzstdpfmyqttnzhgaoa-auth-token, auth-related keys
 * 2. Spotify Auth: spotify_auth_state, spotify_auth_state_backup
 * 3. Error Logging: mako_error_logs, mako_log_metrics
 * 4. Auth Recovery: mako_auth_backup
 * 5. UI State: iframe-banner-dismissed, reviewedGenres
 * 6. Callback Processing: unified_spotify_callback_processing
 * 7. Debug/Cleanup: Various auth/token/session/supabase keys
 */

import { getErrorMessage } from '@/utils/errorUtils';

export interface StorageKey {
  key: string | RegExp;
  type: 'localStorage' | 'sessionStorage';
  category: 'auth' | 'spotify' | 'ui' | 'logging' | 'debug' | 'system' | 'unknown';
  description: string;
  persistent: boolean; // Should survive session cleanup
  version?: string; // For versioning support
}

export interface ResolvedStorageKey {
  key: string;
  type: 'localStorage' | 'sessionStorage';
  category: 'auth' | 'spotify' | 'ui' | 'logging' | 'debug' | 'system' | 'unknown';
  description: string;
  persistent: boolean;
  version?: string;
}

export interface StorageAuditResult {
  totalKeys: number;
  keysByCategory: Record<string, ResolvedStorageKey[]>;
  staleKeys: ResolvedStorageKey[];
  duplicateKeys: ResolvedStorageKey[];
  sizeEstimate: number;
  contamination: {
    level: 'low' | 'medium' | 'high' | 'critical';
    issues: string[];
    recommendations: string[];
  };
}

export interface StorageCleanupOptions {
  categories?: string[];
  preservePersistent?: boolean;
  clearStaleOnly?: boolean;
  dryRun?: boolean;
  version?: string;
}

export class StorageManagerService {
  private static readonly STORAGE_VERSION = '1.0.0';
  private static readonly VERSION_KEY = 'mako_storage_version';
  
  // Comprehensive registry of all known storage keys
  private static readonly STORAGE_REGISTRY: StorageKey[] = [
    // Authentication Keys
    {
      key: 'sb-bzzstdpfmyqttnzhgaoa-auth-token',
      type: 'localStorage',
      category: 'auth',
      description: 'Supabase authentication token',
      persistent: false
    },
    {
      key: /^sb-.*-auth-token$/,
      type: 'localStorage',
      category: 'auth',
      description: 'Supabase auth tokens (pattern)',
      persistent: false
    },
    
    // Spotify Authentication
    {
      key: 'spotify_auth_state',
      type: 'localStorage',
      category: 'spotify',
      description: 'Spotify OAuth state parameter',
      persistent: false
    },
    {
      key: 'spotify_auth_state_backup',
      type: 'sessionStorage',
      category: 'spotify',
      description: 'Backup Spotify OAuth state',
      persistent: false
    },
    
    // Error Logging
    {
      key: 'mako_error_logs',
      type: 'localStorage',
      category: 'logging',
      description: 'Application error logs',
      persistent: true
    },
    {
      key: 'mako_log_metrics',
      type: 'localStorage',
      category: 'logging',
      description: 'Error logging metrics',
      persistent: true
    },
    
    // Auth Recovery
    {
      key: 'mako_auth_backup',
      type: 'localStorage',
      category: 'auth',
      description: 'Authentication state backup',
      persistent: false
    },
    
    // UI State
    {
      key: 'iframe-banner-dismissed',
      type: 'localStorage',
      category: 'ui',
      description: 'Iframe banner dismissal state',
      persistent: true
    },
    {
      key: 'reviewedGenres',
      type: 'localStorage',
      category: 'ui',
      description: 'Genre mapping review state',
      persistent: true
    },
    
    // Session Processing
    {
      key: 'unified_spotify_callback_processing',
      type: 'sessionStorage',
      category: 'spotify',
      description: 'Spotify callback processing flag',
      persistent: false
    },
    
    // Version Control
    {
      key: 'mako_storage_version',
      type: 'localStorage',
      category: 'system',
      description: 'Storage schema version',
      persistent: true
    }
  ];

  /**
   * Perform comprehensive storage audit
   */
  static auditStorage(): StorageAuditResult {
    console.log('🔍 STORAGE AUDIT: Starting comprehensive storage analysis...');
    
    const allKeys: ResolvedStorageKey[] = [];
    const keysByCategory: Record<string, ResolvedStorageKey[]> = {};
    const staleKeys: ResolvedStorageKey[] = [];
    const duplicateKeys: ResolvedStorageKey[] = [];
    let totalSize = 0;

    // Audit localStorage
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const value = localStorage.getItem(key);
        const size = (key.length + (value?.length || 0)) * 2; // Rough byte estimate
        totalSize += size;
        
        const storageKey = this.identifyStorageKey(key, 'localStorage');
        allKeys.push(storageKey);
        
        if (!keysByCategory[storageKey.category]) {
          keysByCategory[storageKey.category] = [];
        }
        keysByCategory[storageKey.category].push(storageKey);
        
        // Check for stale keys
        if (this.isStaleKey(key, value)) {
          staleKeys.push(storageKey);
        }
      }
    }

    // Audit sessionStorage
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key) {
        const value = sessionStorage.getItem(key);
        const size = (key.length + (value?.length || 0)) * 2;
        totalSize += size;
        
        const storageKey = this.identifyStorageKey(key, 'sessionStorage');
        allKeys.push(storageKey);
        
        if (!keysByCategory[storageKey.category]) {
          keysByCategory[storageKey.category] = [];
        }
        keysByCategory[storageKey.category].push(storageKey);
        
        // Check for stale keys
        if (this.isStaleKey(key, value)) {
          staleKeys.push(storageKey);
        }
      }
    }

    // Detect duplicates (same data in both localStorage and sessionStorage)
    const localKeys = allKeys.filter(k => k.type === 'localStorage').map(k => k.key);
    const sessionKeys = allKeys.filter(k => k.type === 'sessionStorage').map(k => k.key);
    const duplicates = localKeys.filter(key => sessionKeys.includes(key));
    
    duplicates.forEach(key => {
      const localKey = allKeys.find(k => k.key === key && k.type === 'localStorage');
      const sessionKey = allKeys.find(k => k.key === key && k.type === 'sessionStorage');
      if (localKey) duplicateKeys.push(localKey);
      if (sessionKey) duplicateKeys.push(sessionKey);
    });

    // Assess contamination level
    const contamination = this.assessContamination(allKeys, staleKeys, duplicateKeys, totalSize);

    const result: StorageAuditResult = {
      totalKeys: allKeys.length,
      keysByCategory,
      staleKeys,
      duplicateKeys,
      sizeEstimate: totalSize,
      contamination
    };

    console.log('🔍 STORAGE AUDIT: Analysis complete', {
      totalKeys: result.totalKeys,
      categories: Object.keys(keysByCategory),
      staleCount: staleKeys.length,
      duplicateCount: duplicateKeys.length,
      sizeKB: Math.round(totalSize / 1024),
      contaminationLevel: contamination.level
    });

    return result;
  }

  /**
   * Clean storage based on options
   */
  static async cleanStorage(options: StorageCleanupOptions = {}): Promise<{
    cleaned: ResolvedStorageKey[];
    preserved: ResolvedStorageKey[];
    errors: string[];
  }> {
    console.log('🧹 STORAGE CLEANUP: Starting cleanup with options:', options);
    
    const {
      categories = ['auth', 'spotify', 'debug'],
      preservePersistent = true,
      clearStaleOnly = false,
      dryRun = false
    } = options;

    const cleaned: ResolvedStorageKey[] = [];
    const preserved: ResolvedStorageKey[] = [];
    const errors: string[] = [];

    try {
      // Get current storage state
      const audit = this.auditStorage();
      
      // Determine keys to clean
      const keysToClean = Object.values(audit.keysByCategory)
        .flat()
        .filter(storageKey => {
          // Filter by category
          if (!categories.includes(storageKey.category)) {
            return false;
          }
          
          // Preserve persistent keys if requested
          if (preservePersistent && storageKey.persistent) {
            preserved.push(storageKey);
            return false;
          }
          
          // Only clean stale keys if requested
          if (clearStaleOnly && !audit.staleKeys.includes(storageKey)) {
            return false;
          }
          
          return true;
        });

      // Perform cleanup
      for (const storageKey of keysToClean) {
        try {
          if (!dryRun) {
            if (storageKey.type === 'localStorage') {
              localStorage.removeItem(storageKey.key);
            } else {
              sessionStorage.removeItem(storageKey.key);
            }
          }
          
          cleaned.push(storageKey);
          console.log(`🧹 CLEANED: ${storageKey.type}.${storageKey.key} (${storageKey.category})`);
        } catch (error: unknown) {
          const errorMsg = `Failed to clean ${storageKey.key}: ${getErrorMessage(error)}`;
          errors.push(errorMsg);
          console.error('❌ CLEANUP ERROR:', errorMsg);
        }
      }

      // Update storage version after cleanup
      if (!dryRun && cleaned.length > 0) {
        this.updateStorageVersion();
      }

      console.log('🧹 STORAGE CLEANUP: Complete', {
        cleaned: cleaned.length,
        preserved: preserved.length,
        errors: errors.length,
        dryRun
      });

      return { cleaned, preserved, errors };
    } catch (error: unknown) {
      console.error('❌ STORAGE CLEANUP: Critical error:', error);
      errors.push(`Critical cleanup error: ${getErrorMessage(error)}`);
      return { cleaned, preserved, errors };
    }
  }

  /**
   * Initialize storage versioning system
   */
  static initializeVersioning(): void {
    const currentVersion = localStorage.getItem(this.VERSION_KEY);
    
    if (!currentVersion) {
      console.log('🔧 STORAGE VERSION: Initializing versioning system');
      localStorage.setItem(this.VERSION_KEY, this.STORAGE_VERSION);
    } else if (currentVersion !== this.STORAGE_VERSION) {
      console.log('🔧 STORAGE VERSION: Version mismatch detected', {
        current: currentVersion,
        expected: this.STORAGE_VERSION
      });
      this.handleVersionMigration(currentVersion, this.STORAGE_VERSION);
    }
  }

  /**
   * Create storage isolation for new sessions
   */
  static createSessionIsolation(): string {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Clear session-specific storage
    this.cleanStorage({
      categories: ['auth', 'spotify'],
      preservePersistent: true,
      dryRun: false
    });
    
    // Mark session start
    sessionStorage.setItem('mako_session_id', sessionId);
    sessionStorage.setItem('mako_session_start', new Date().toISOString());
    
    console.log('🔒 SESSION ISOLATION: Created isolated session', { sessionId });
    return sessionId;
  }

  /**
   * Get storage debugging information
   */
  static getDebugInfo(): {
    audit: StorageAuditResult;
    version: string | null;
    sessionId: string | null;
    recommendations: string[];
  } {
    const audit = this.auditStorage();
    const version = localStorage.getItem(this.VERSION_KEY);
    const sessionId = sessionStorage.getItem('mako_session_id');
    
    const recommendations = [
      ...audit.contamination.recommendations,
      audit.staleKeys.length > 0 ? 'Clean stale storage keys' : null,
      audit.duplicateKeys.length > 0 ? 'Remove duplicate storage entries' : null,
      audit.sizeEstimate > 1024 * 1024 ? 'Storage size is large, consider cleanup' : null
    ].filter(Boolean) as string[];

    return {
      audit,
      version,
      sessionId,
      recommendations
    };
  }

  /**
   * Emergency storage reset
   */
  static emergencyReset(): void {
    console.warn('🚨 EMERGENCY RESET: Clearing all application storage');
    
    try {
      // Clear all localStorage except critical system keys
      const criticalKeys = ['mako_storage_version'];
      const keysToPreserve: Record<string, string> = {};
      
      criticalKeys.forEach(key => {
        const value = localStorage.getItem(key);
        if (value) keysToPreserve[key] = value;
      });
      
      localStorage.clear();
      
      // Restore critical keys
      Object.entries(keysToPreserve).forEach(([key, value]) => {
        localStorage.setItem(key, value);
      });
      
      // Clear all sessionStorage
      sessionStorage.clear();
      
      // Clear caches
      if ('caches' in window) {
        caches.keys().then(cacheNames => {
          cacheNames.forEach(cacheName => {
            caches.delete(cacheName);
          });
        });
      }
      
      console.log('🚨 EMERGENCY RESET: Complete');
    } catch (error) {
      console.error('❌ EMERGENCY RESET: Failed:', error);
    }
  }

  // Private helper methods

  private static identifyStorageKey(key: string, type: 'localStorage' | 'sessionStorage'): ResolvedStorageKey {
    // Check against registry
    for (const registryKey of this.STORAGE_REGISTRY) {
      if (registryKey.key instanceof RegExp) {
        if (registryKey.key.test(key) && registryKey.type === type) {
          return {
            key,
            type,
            category: registryKey.category,
            description: registryKey.description,
            persistent: registryKey.persistent
          };
        }
      } else if (registryKey.key === key && registryKey.type === type) {
        return {
          key,
          type,
          category: registryKey.category,
          description: registryKey.description,
          persistent: registryKey.persistent
        };
      }
    }
    
    // Categorize unknown keys
    const category = this.categorizeUnknownKey(key);
    return {
      key,
      type,
      category: category as ResolvedStorageKey['category'],
      description: `Unknown ${category} key`,
      persistent: false
    };
  }

  private static categorizeUnknownKey(key: string): string {
    if (key.includes('auth') || key.includes('token') || key.includes('session')) {
      return 'auth';
    }
    if (key.includes('spotify')) {
      return 'spotify';
    }
    if (key.includes('supabase') || key.includes('sb-')) {
      return 'auth';
    }
    if (key.includes('debug') || key.includes('test')) {
      return 'debug';
    }
    if (key.includes('mako')) {
      return 'system';
    }
    return 'unknown';
  }

  private static isStaleKey(key: string, value: string | null): boolean {
    if (!value) return true;
    
    try {
      // Check for expired timestamps
      if (key.includes('timestamp') || key.includes('time')) {
        const timestamp = parseInt(value);
        if (!isNaN(timestamp) && Date.now() - timestamp > 24 * 60 * 60 * 1000) {
          return true;
        }
      }
      
      // Check for expired JSON objects with timestamps
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') {
        if (parsed.timestamp || parsed.expires_at || parsed.backupTime) {
          const timestamp = new Date(parsed.timestamp || parsed.expires_at || parsed.backupTime).getTime();
          if (Date.now() - timestamp > 24 * 60 * 60 * 1000) {
            return true;
          }
        }
      }
    } catch {
      // Not JSON, check other patterns
    }
    
    return false;
  }

  private static assessContamination(
    allKeys: ResolvedStorageKey[],
    staleKeys: ResolvedStorageKey[],
    duplicateKeys: ResolvedStorageKey[],
    totalSize: number
  ): StorageAuditResult['contamination'] {
    const issues: string[] = [];
    const recommendations: string[] = [];
    
    // Analyze issues
    if (staleKeys.length > 5) {
      issues.push(`${staleKeys.length} stale storage keys detected`);
      recommendations.push('Clean stale storage keys to prevent data corruption');
    }
    
    if (duplicateKeys.length > 0) {
      issues.push(`${duplicateKeys.length} duplicate keys across storage types`);
      recommendations.push('Remove duplicate storage entries to prevent conflicts');
    }
    
    const authKeys = allKeys.filter(k => k.category === 'auth').length;
    if (authKeys > 10) {
      issues.push(`Excessive auth keys (${authKeys}) may indicate session leakage`);
      recommendations.push('Implement proper auth session cleanup');
    }
    
    if (totalSize > 5 * 1024 * 1024) { // 5MB
      issues.push(`Large storage size (${Math.round(totalSize / 1024 / 1024)}MB)`);
      recommendations.push('Consider implementing storage size limits');
    }
    
    // Determine contamination level
    let level: 'low' | 'medium' | 'high' | 'critical' = 'low';
    
    if (issues.length === 0) {
      level = 'low';
    } else if (issues.length <= 2 && staleKeys.length <= 10) {
      level = 'medium';
    } else if (issues.length <= 4 || staleKeys.length <= 20) {
      level = 'high';
    } else {
      level = 'critical';
    }
    
    return { level, issues, recommendations };
  }

  private static updateStorageVersion(): void {
    localStorage.setItem(this.VERSION_KEY, this.STORAGE_VERSION);
    console.log('🔧 STORAGE VERSION: Updated to', this.STORAGE_VERSION);
  }

  private static handleVersionMigration(oldVersion: string, newVersion: string): void {
    console.log('🔧 STORAGE MIGRATION: Migrating from', oldVersion, 'to', newVersion);
    
    // Implement version-specific migrations here
    // For now, just update the version
    this.updateStorageVersion();
  }
}

export default StorageManagerService;