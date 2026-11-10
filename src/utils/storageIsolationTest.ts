/**
 * Storage Isolation Test Utility
 * 
 * Tests storage isolation between sessions to prevent contamination.
 * This utility validates that storage cleanup and isolation work correctly.
 */

import StorageManagerService from '@/services/storageManager.service';
import { getErrorMessage } from '@/utils/errorUtils';

export interface IsolationTestResult {
  testName: string;
  passed: boolean;
  details: string;
  duration: number;
}

export interface IsolationTestSuite {
  suiteName: string;
  results: IsolationTestResult[];
  overallPassed: boolean;
  totalDuration: number;
  summary: {
    passed: number;
    failed: number;
    total: number;
  };
}

export class StorageIsolationTester {
  private static readonly TEST_KEYS = {
    auth: 'test_auth_token',
    spotify: 'test_spotify_state',
    ui: 'test_ui_preference',
    logging: 'test_log_entry',
    debug: 'test_debug_flag'
  };

  /**
   * Run comprehensive storage isolation tests
   */
  static async runIsolationTests(): Promise<IsolationTestSuite> {
    console.log('🧪 STORAGE ISOLATION: Starting test suite...');
    const suiteStartTime = Date.now();
    const results: IsolationTestResult[] = [];

    // Test 1: Basic Storage Cleanup
    results.push(await this.testBasicCleanup());

    // Test 2: Category-Specific Cleanup
    results.push(await this.testCategoryCleanup());

    // Test 3: Persistent Key Preservation
    results.push(await this.testPersistentPreservation());

    // Test 4: Stale Key Detection
    results.push(await this.testStaleKeyDetection());

    // Test 5: Session Isolation
    results.push(await this.testSessionIsolation());

    // Test 6: Cross-Storage Contamination
    results.push(await this.testCrossStorageContamination());

    // Test 7: Version Migration
    results.push(await this.testVersionMigration());

    const totalDuration = Date.now() - suiteStartTime;
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;

    const suite: IsolationTestSuite = {
      suiteName: 'Storage Isolation Test Suite',
      results,
      overallPassed: failed === 0,
      totalDuration,
      summary: {
        passed,
        failed,
        total: results.length
      }
    };

    console.log('🧪 STORAGE ISOLATION: Test suite complete', {
      passed,
      failed,
      total: results.length,
      duration: totalDuration
    });

    return suite;
  }

  /**
   * Test basic storage cleanup functionality
   */
  private static async testBasicCleanup(): Promise<IsolationTestResult> {
    const startTime = Date.now();
    
    try {
      // Setup: Add test keys
      localStorage.setItem(this.TEST_KEYS.auth, 'test_value');
      sessionStorage.setItem(this.TEST_KEYS.spotify, 'test_value');
      
      // Verify keys exist
      const beforeCleanup = localStorage.getItem(this.TEST_KEYS.auth) !== null &&
                           sessionStorage.getItem(this.TEST_KEYS.spotify) !== null;
      
      if (!beforeCleanup) {
        return {
          testName: 'Basic Storage Cleanup',
          passed: false,
          details: 'Failed to setup test keys',
          duration: Date.now() - startTime
        };
      }

      // Perform cleanup
      await StorageManagerService.cleanStorage({
        categories: ['auth', 'spotify'],
        preservePersistent: false,
        dryRun: false
      });

      // Verify keys are removed
      const afterCleanup = localStorage.getItem(this.TEST_KEYS.auth) === null &&
                          sessionStorage.getItem(this.TEST_KEYS.spotify) === null;

      return {
        testName: 'Basic Storage Cleanup',
        passed: afterCleanup,
        details: afterCleanup ? 'Successfully cleaned test keys' : 'Failed to clean test keys',
        duration: Date.now() - startTime
      };
    } catch (error: unknown) {
      return {
        testName: 'Basic Storage Cleanup',
        passed: false,
        details: `Error: ${getErrorMessage(error)}`,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Test category-specific cleanup
   */
  private static async testCategoryCleanup(): Promise<IsolationTestResult> {
    const startTime = Date.now();
    
    try {
      // Setup: Add keys from different categories
      localStorage.setItem(this.TEST_KEYS.auth, 'auth_value');
      localStorage.setItem(this.TEST_KEYS.ui, 'ui_value');
      
      // Clean only auth category
      await StorageManagerService.cleanStorage({
        categories: ['auth'],
        preservePersistent: false,
        dryRun: false
      });

      // Verify only auth keys are removed
      const authRemoved = localStorage.getItem(this.TEST_KEYS.auth) === null;
      const uiPreserved = localStorage.getItem(this.TEST_KEYS.ui) !== null;

      // Cleanup
      localStorage.removeItem(this.TEST_KEYS.ui);

      return {
        testName: 'Category-Specific Cleanup',
        passed: authRemoved && uiPreserved,
        details: authRemoved && uiPreserved ? 
          'Successfully cleaned only specified category' : 
          'Failed to clean only specified category',
        duration: Date.now() - startTime
      };
    } catch (error: unknown) {
      return {
        testName: 'Category-Specific Cleanup',
        passed: false,
        details: `Error: ${getErrorMessage(error)}`,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Test persistent key preservation
   */
  private static async testPersistentPreservation(): Promise<IsolationTestResult> {
    const startTime = Date.now();
    
    try {
      // Setup: Add persistent and non-persistent keys
      localStorage.setItem('iframe-banner-dismissed', 'true'); // Known persistent key
      localStorage.setItem(this.TEST_KEYS.auth, 'temp_value'); // Non-persistent
      
      // Clean with persistent preservation
      await StorageManagerService.cleanStorage({
        categories: ['auth', 'ui'],
        preservePersistent: true,
        dryRun: false
      });

      // Verify persistent key preserved, non-persistent removed
      const persistentPreserved = localStorage.getItem('iframe-banner-dismissed') !== null;
      const nonPersistentRemoved = localStorage.getItem(this.TEST_KEYS.auth) === null;

      // Cleanup
      localStorage.removeItem('iframe-banner-dismissed');

      return {
        testName: 'Persistent Key Preservation',
        passed: persistentPreserved && nonPersistentRemoved,
        details: persistentPreserved && nonPersistentRemoved ? 
          'Successfully preserved persistent keys' : 
          'Failed to preserve persistent keys',
        duration: Date.now() - startTime
      };
    } catch (error: unknown) {
      return {
        testName: 'Persistent Key Preservation',
        passed: false,
        details: `Error: ${getErrorMessage(error)}`,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Test stale key detection
   */
  private static async testStaleKeyDetection(): Promise<IsolationTestResult> {
    const startTime = Date.now();
    
    try {
      // Setup: Add stale key (old timestamp)
      const staleData = {
        timestamp: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25 hours ago
        value: 'stale_value'
      };
      localStorage.setItem('test_stale_key', JSON.stringify(staleData));
      
      // Add fresh key
      localStorage.setItem('test_fresh_key', 'fresh_value');

      // Perform audit
      const audit = StorageManagerService.auditStorage();
      
      // Check if stale key is detected
      const staleDetected = audit.staleKeys.some(key => key.key === 'test_stale_key');

      // Cleanup
      localStorage.removeItem('test_stale_key');
      localStorage.removeItem('test_fresh_key');

      return {
        testName: 'Stale Key Detection',
        passed: staleDetected,
        details: staleDetected ? 
          'Successfully detected stale keys' : 
          'Failed to detect stale keys',
        duration: Date.now() - startTime
      };
    } catch (error: unknown) {
      return {
        testName: 'Stale Key Detection',
        passed: false,
        details: `Error: ${getErrorMessage(error)}`,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Test session isolation
   */
  private static async testSessionIsolation(): Promise<IsolationTestResult> {
    const startTime = Date.now();
    
    try {
      // Setup: Add session-specific keys
      sessionStorage.setItem(this.TEST_KEYS.spotify, 'session_value');
      localStorage.setItem(this.TEST_KEYS.auth, 'auth_value');
      
      // Create isolated session
      const sessionId = StorageManagerService.createSessionIsolation();
      
      // Verify session isolation
      const sessionCleared = sessionStorage.getItem(this.TEST_KEYS.spotify) === null;
      const sessionIdSet = sessionStorage.getItem('mako_session_id') === sessionId;
      const authCleared = localStorage.getItem(this.TEST_KEYS.auth) === null;

      return {
        testName: 'Session Isolation',
        passed: sessionCleared && sessionIdSet && authCleared,
        details: sessionCleared && sessionIdSet && authCleared ? 
          'Successfully created isolated session' : 
          'Failed to create isolated session',
        duration: Date.now() - startTime
      };
    } catch (error: unknown) {
      return {
        testName: 'Session Isolation',
        passed: false,
        details: `Error: ${getErrorMessage(error)}`,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Test cross-storage contamination detection
   */
  private static async testCrossStorageContamination(): Promise<IsolationTestResult> {
    const startTime = Date.now();
    
    try {
      // Setup: Add same key to both storages
      const testKey = 'duplicate_test_key';
      localStorage.setItem(testKey, 'local_value');
      sessionStorage.setItem(testKey, 'session_value');
      
      // Perform audit
      const audit = StorageManagerService.auditStorage();
      
      // Check if duplicate is detected
      const duplicateDetected = audit.duplicateKeys.some(key => key.key === testKey);

      // Cleanup
      localStorage.removeItem(testKey);
      sessionStorage.removeItem(testKey);

      return {
        testName: 'Cross-Storage Contamination Detection',
        passed: duplicateDetected,
        details: duplicateDetected ? 
          'Successfully detected cross-storage contamination' : 
          'Failed to detect cross-storage contamination',
        duration: Date.now() - startTime
      };
    } catch (error: unknown) {
      return {
        testName: 'Cross-Storage Contamination Detection',
        passed: false,
        details: `Error: ${getErrorMessage(error)}`,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Test version migration
   */
  private static async testVersionMigration(): Promise<IsolationTestResult> {
    const startTime = Date.now();
    
    try {
      // Setup: Set old version
      const oldVersion = '0.9.0';
      localStorage.setItem('mako_storage_version', oldVersion);
      
      // Initialize versioning (should trigger migration)
      StorageManagerService.initializeVersioning();
      
      // Check if version was updated
      const currentVersion = localStorage.getItem('mako_storage_version');
      const versionUpdated = currentVersion !== oldVersion;

      return {
        testName: 'Version Migration',
        passed: versionUpdated,
        details: versionUpdated ? 
          `Successfully migrated from ${oldVersion} to ${currentVersion}` : 
          'Failed to migrate version',
        duration: Date.now() - startTime
      };
    } catch (error: unknown) {
      return {
        testName: 'Version Migration',
        passed: false,
        details: `Error: ${getErrorMessage(error)}`,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Generate test report
   */
  static generateTestReport(suite: IsolationTestSuite): string {
    const lines = [
      '# Storage Isolation Test Report',
      '',
      `**Suite:** ${suite.suiteName}`,
      `**Overall Result:** ${suite.overallPassed ? '✅ PASSED' : '❌ FAILED'}`,
      `**Duration:** ${suite.totalDuration}ms`,
      '',
      '## Summary',
      `- Passed: ${suite.summary.passed}`,
      `- Failed: ${suite.summary.failed}`,
      `- Total: ${suite.summary.total}`,
      '',
      '## Test Results',
      ''
    ];

    suite.results.forEach(result => {
      lines.push(`### ${result.testName}`);
      lines.push(`**Result:** ${result.passed ? '✅ PASSED' : '❌ FAILED'}`);
      lines.push(`**Duration:** ${result.duration}ms`);
      lines.push(`**Details:** ${result.details}`);
      lines.push('');
    });

    lines.push('---');
    lines.push(`Generated at: ${new Date().toISOString()}`);

    return lines.join('\n');
  }

  /**
   * Run quick contamination check
   */
  static quickContaminationCheck(): {
    contaminated: boolean;
    issues: string[];
    keyCount: number;
  } {
    const audit = StorageManagerService.auditStorage();
    
    const issues = [];
    if (audit.staleKeys.length > 0) {
      issues.push(`${audit.staleKeys.length} stale keys detected`);
    }
    if (audit.duplicateKeys.length > 0) {
      issues.push(`${audit.duplicateKeys.length} duplicate keys detected`);
    }
    if (audit.contamination.level === 'high' || audit.contamination.level === 'critical') {
      issues.push(`${audit.contamination.level} contamination level`);
    }

    return {
      contaminated: issues.length > 0,
      issues,
      keyCount: audit.totalKeys
    };
  }
}

export default StorageIsolationTester;