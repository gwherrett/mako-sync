/**
 * ESLint Plugin for Mako Agents
 * Integrates agent rules with ESLint
 */

import { Rule } from 'eslint';
import { AgentRegistry } from '../core/AgentRegistry';
import { debugAgent } from '../agents/DebugAgent';
import { authAgent } from '../agents/AuthAgent';
import { ValidationContext } from '../core/types';

// Register agents
const registry = AgentRegistry.getInstance();
registry.registerAgent(debugAgent);
registry.registerAgent(authAgent);

/**
 * Convert an agent rule to an ESLint rule
 */
function createESLintRule(ruleId: string): Rule.RuleModule {
  return {
    meta: {
      type: 'problem',
      docs: {
        description: `Mako agent rule: ${ruleId}`,
        recommended: true
      },
      schema: []
    },

    create(context: Rule.RuleContext) {
      return {
        Program(node: any) {
          // ESLint 10 removed getSourceCode()/getFilename(); the properties exist since 8.40
          const sourceCode = context.sourceCode;
          const filename = context.filename;
          const text = sourceCode.getText();

          // Create validation context
          const validationContext: ValidationContext = {
            fileContent: text,
            filePath: filename,
            fileExtension: filename.substring(filename.lastIndexOf('.')),
            projectRoot: process.cwd()
          };

          // Find the specific rule
          const agentRule = registry
            .getAllRules()
            .find(r => r.config.id === ruleId);

          if (!agentRule) {
            return;
          }

          // Validate
          Promise.resolve(agentRule.validate(validationContext))
            .then(violations => {
              violations.forEach(violation => {
                context.report({
                  node,
                  message: violation.message,
                  loc: violation.line
                    ? {
                        start: { line: violation.line, column: violation.column || 0 },
                        end: { line: violation.line, column: violation.column || 0 }
                      }
                    : undefined
                });
              });
            })
            .catch(error => {
              console.error(`Error running rule ${ruleId}:`, error);
            });
        }
      };
    }
  };
}

// Export rules
const rules: Record<string, Rule.RuleModule> = {};

// Register all agent rules as ESLint rules
const allRules = registry.getAllRules();
allRules.forEach(rule => {
  const eslintRuleId = rule.config.id.replace(/-/g, '_');
  rules[eslintRuleId] = createESLintRule(rule.config.id);
});

// Export plugin configuration
export = {
  rules,
  configs: {
    recommended: {
      plugins: ['@mako/agents'],
      rules: {
        // Enable all error-level rules
        ...Object.keys(rules).reduce((acc, ruleId) => {
          const agentRule = allRules.find(r => r.config.id === ruleId.replace(/_/g, '-'));
          if (agentRule?.config.severity === 'error') {
            acc[`@mako/agents/${ruleId}`] = 'error';
          } else if (agentRule?.config.severity === 'warning') {
            acc[`@mako/agents/${ruleId}`] = 'warn';
          }
          return acc;
        }, {} as Record<string, string>)
      }
    },
    all: {
      plugins: ['@mako/agents'],
      rules: Object.keys(rules).reduce((acc, ruleId) => {
        acc[`@mako/agents/${ruleId}`] = 'warn';
        return acc;
      }, {} as Record<string, string>)
    }
  }
};
