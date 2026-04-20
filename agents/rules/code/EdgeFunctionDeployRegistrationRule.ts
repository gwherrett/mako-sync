import { readFileSync } from 'fs';
import { join } from 'path';
import { BaseRule } from '../../core/Rule';
import { RuleCategory, RuleSeverity, RuleViolation, ValidationContext } from '../../core/types';

const WORKFLOW_REL = '.github/workflows/deploy-edge-functions.yml';

export class EdgeFunctionDeployRegistrationRule extends BaseRule {
  constructor() {
    super({
      id: 'code-007-edge-function-deploy-registration',
      category: RuleCategory.ARCHITECTURE,
      severity: RuleSeverity.ERROR,
      description: 'Every edge function must have a deploy step in deploy-edge-functions.yml',
      rationale: 'Functions missing from the workflow are never deployed to production',
      filePatterns: ['**/supabase/functions/**/index.ts'],
      excludePatterns: ['**/node_modules/**', '**/dist/**', '**/build/**'],
    });
  }

  validate(context: ValidationContext): RuleViolation[] {
    const { filePath, projectRoot } = context;

    // Extract function name: supabase/functions/<name>/index.ts
    const match = filePath.match(/supabase\/functions\/([^/]+)\/index\.ts$/);
    if (!match) return [];

    const functionName = match[1];

    // Shared utilities dir is not a deployed function
    if (functionName.startsWith('_')) return [];

    let workflowContent: string;
    try {
      workflowContent = readFileSync(join(projectRoot, WORKFLOW_REL), 'utf-8');
    } catch {
      return [];
    }

    const isRegistered = workflowContent.includes(`functions deploy ${functionName}`);
    if (isRegistered) return [];

    return [
      this.createViolation(
        context,
        `Edge function "${functionName}" is not registered in ${WORKFLOW_REL}`,
        1,
        undefined,
        undefined,
        `Add "supabase functions deploy ${functionName}" to ${WORKFLOW_REL}`
      ),
    ];
  }
}
