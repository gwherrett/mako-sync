/**
 * Code Agent - Validates coding patterns and best practices
 */

import { BaseAgent } from '../core/Agent';
import {
  ServiceLayerRule,
  SupabaseClientImportRule,
  EdgeFunctionIsolationRule,
  SuperGenresSortingRule,
  BufferGlobalSetupRule,
  SpotifyManagerSingletonRule,
  EdgeFunctionDeployRegistrationRule
} from '../rules/code';

export class CodeAgent extends BaseAgent {
  constructor() {
    super({
      id: 'code',
      name: 'Code Agent',
      description: 'Validates coding patterns and enforces best practices',
      version: '1.0.0'
    });

    // Register all code rules
    this.registerRule(new ServiceLayerRule());
    this.registerRule(new SupabaseClientImportRule());
    this.registerRule(new EdgeFunctionIsolationRule());
    this.registerRule(new SuperGenresSortingRule());
    this.registerRule(new BufferGlobalSetupRule());
    this.registerRule(new SpotifyManagerSingletonRule());
    this.registerRule(new EdgeFunctionDeployRegistrationRule());
  }
}

export const codeAgent = new CodeAgent();
