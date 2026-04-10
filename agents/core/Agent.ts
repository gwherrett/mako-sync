/**
 * Base Agent interface and abstract class
 */

import { Rule } from './Rule';
import { RuleViolation, ValidationContext } from './types';

/** Accumulated timing data per rule ID, populated when timing is enabled. */
export const ruleTiming: Map<string, { totalMs: number; count: number }> = new Map();
export let timingEnabled = false;

export function enableTiming(): void {
  timingEnabled = true;
}

export interface AgentConfig {
  /** Unique agent identifier */
  id: string;
  /** Human-readable agent name */
  name: string;
  /** Description of agent's purpose */
  description: string;
  /** Version of the agent */
  version: string;
}

export interface Agent {
  /** Agent configuration */
  config: AgentConfig;

  /** Rules managed by this agent */
  rules: Rule[];

  /**
   * Validate all rules against the given context
   * @returns Array of all violations found
   */
  validate(context: ValidationContext): Promise<RuleViolation[]>;

  /**
   * Register a new rule with this agent
   */
  registerRule(rule: Rule): void;

  /**
   * Get all rules managed by this agent
   */
  getRules(): Rule[];
}

export abstract class BaseAgent implements Agent {
  public rules: Rule[] = [];

  constructor(public config: AgentConfig) {}

  async validate(context: ValidationContext): Promise<RuleViolation[]> {
    const violations: RuleViolation[] = [];

    for (const rule of this.rules) {
      // Skip rules that don't apply to this file
      if (!rule.appliesTo(context.filePath)) {
        continue;
      }

      try {
        const t0 = timingEnabled ? performance.now() : 0;
        const ruleViolations = await Promise.resolve(rule.validate(context));
        if (timingEnabled) {
          const elapsed = performance.now() - t0;
          const entry = ruleTiming.get(rule.config.id) ?? { totalMs: 0, count: 0 };
          entry.totalMs += elapsed;
          entry.count += 1;
          ruleTiming.set(rule.config.id, entry);
        }
        violations.push(...ruleViolations);
      } catch (error) {
        console.error(`Error validating rule ${rule.config.id}:`, error);
      }
    }

    return violations;
  }

  registerRule(rule: Rule): void {
    // Check if rule with same ID already exists
    const existingIndex = this.rules.findIndex(r => r.config.id === rule.config.id);

    if (existingIndex >= 0) {
      // Replace existing rule
      this.rules[existingIndex] = rule;
    } else {
      this.rules.push(rule);
    }
  }

  getRules(): Rule[] {
    return [...this.rules];
  }
}
