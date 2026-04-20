/**
 * Auth Agent - Validates authentication context patterns
 */

import { BaseAgent } from '../core/Agent';
import {
  AuthContextConsolidationRule,
  AuthImportPatternRule,
  AuthDeferredLoadingRule,
  AuthInitializationGuardRule,
  AuthFetchGateRule
} from '../rules/auth';

export class AuthAgent extends BaseAgent {
  constructor() {
    super({
      id: 'auth',
      name: 'Auth Agent',
      description: 'Validates authentication context patterns and prevents auth-related bugs',
      version: '1.0.0'
    });

    // Register all auth rules
    this.registerRule(new AuthContextConsolidationRule());
    this.registerRule(new AuthImportPatternRule());
    this.registerRule(new AuthDeferredLoadingRule());
    this.registerRule(new AuthInitializationGuardRule());
    this.registerRule(new AuthFetchGateRule());
  }
}

export const authAgent = new AuthAgent();
