/**
 * Central registry for all agents and rules
 */

import { Agent } from './Agent';
import { Rule } from './Rule';
import { RuleViolation, ValidationContext, ValidationResult } from './types';

export class AgentRegistry {
  private static instance: AgentRegistry;
  private agents: Map<string, Agent> = new Map();

  private constructor() {}

  static getInstance(): AgentRegistry {
    if (!AgentRegistry.instance) {
      AgentRegistry.instance = new AgentRegistry();
    }
    return AgentRegistry.instance;
  }

  /**
   * Register an agent with the registry
   */
  registerAgent(agent: Agent): void {
    if (this.agents.has(agent.config.id)) {
      console.warn(`Agent ${agent.config.id} is already registered. Overwriting.`);
    }
    this.agents.set(agent.config.id, agent);
  }

  /**
   * Get an agent by ID
   */
  getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  /**
   * Get all registered agents
   */
  getAllAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get all rules across all agents
   */
  getAllRules(): Rule[] {
    const allRules: Rule[] = [];
    for (const agent of this.agents.values()) {
      allRules.push(...agent.getRules());
    }
    return allRules;
  }

  /**
   * Validate a single file against all registered agents
   */
  async validateFile(context: ValidationContext): Promise<RuleViolation[]> {
    const violations: RuleViolation[] = [];

    for (const agent of this.agents.values()) {
      const agentViolations = await agent.validate(context);
      violations.push(...agentViolations);
    }

    return violations;
  }

  /**
   * Validate multiple files against all registered agents
   */
  async validateFiles(contexts: ValidationContext[]): Promise<ValidationResult> {
    const startTime = Date.now();
    const allViolations: RuleViolation[] = [];

    for (const context of contexts) {
      const violations = await this.validateFile(context);
      allViolations.push(...violations);
    }

    const duration = Date.now() - startTime;
    const hasErrors = allViolations.some(v => v.severity === 'error');
    const hasWarnings = allViolations.some(v => v.severity === 'warning');
    const exitCode: 0 | 1 | 2 = hasErrors ? 2 : hasWarnings ? 1 : 0;

    return {
      filesScanned: contexts.length,
      violationCount: allViolations.length,
      violations: allViolations,
      duration,
      success: !hasErrors,
      exitCode
    };
  }

  /**
   * Clear all registered agents (useful for testing)
   */
  clear(): void {
    this.agents.clear();
  }

  /**
   * Get statistics about registered agents and rules
   */
  getStats(): {
    agentCount: number;
    ruleCount: number;
    rulesByCategory: Record<string, number>;
  } {
    const allRules = this.getAllRules();
    const rulesByCategory: Record<string, number> = {};

    for (const rule of allRules) {
      const category = rule.config.category;
      rulesByCategory[category] = (rulesByCategory[category] || 0) + 1;
    }

    return {
      agentCount: this.agents.size,
      ruleCount: allRules.length,
      rulesByCategory
    };
  }
}
