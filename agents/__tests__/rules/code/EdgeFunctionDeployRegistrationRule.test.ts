import { EdgeFunctionDeployRegistrationRule } from '../../../rules/code/EdgeFunctionDeployRegistrationRule';
import { ValidationContext } from '../../../core/types';

jest.mock('fs');
import { readFileSync } from 'fs';

const WORKFLOW_WITH_MY_FUNC = `
  supabase functions deploy spotify-auth
  supabase functions deploy my-function
`;

const WORKFLOW_WITHOUT_MY_FUNC = `
  supabase functions deploy spotify-auth
`;

function ctx(filePath: string): ValidationContext {
  return { fileContent: '', filePath, fileExtension: '.ts', projectRoot: '/project' };
}

describe('EdgeFunctionDeployRegistrationRule', () => {
  let rule: EdgeFunctionDeployRegistrationRule;

  beforeEach(() => {
    rule = new EdgeFunctionDeployRegistrationRule();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports no violation when function is registered in workflow', () => {
    (readFileSync as jest.Mock).mockReturnValue(WORKFLOW_WITH_MY_FUNC);
    const violations = rule.validate(ctx('/project/supabase/functions/my-function/index.ts'));
    expect(violations).toHaveLength(0);
  });

  it('reports error when function is missing from workflow', () => {
    (readFileSync as jest.Mock).mockReturnValue(WORKFLOW_WITHOUT_MY_FUNC);
    const violations = rule.validate(ctx('/project/supabase/functions/my-function/index.ts'));
    expect(violations).toHaveLength(1);
    expect(violations[0].severity).toBe('error');
    expect(violations[0].message).toContain('my-function');
    expect(violations[0].suggestedFix).toContain('supabase functions deploy my-function');
  });

  it('ignores shared utility directories (starting with _)', () => {
    (readFileSync as jest.Mock).mockReturnValue(WORKFLOW_WITHOUT_MY_FUNC);
    const violations = rule.validate(ctx('/project/supabase/functions/_shared/index.ts'));
    expect(violations).toHaveLength(0);
  });

  it('ignores files that are not edge function index.ts', () => {
    (readFileSync as jest.Mock).mockReturnValue(WORKFLOW_WITHOUT_MY_FUNC);
    const violations = rule.validate(ctx('/project/src/services/someService.ts'));
    expect(violations).toHaveLength(0);
  });

  it('returns no violation when workflow file cannot be read', () => {
    (readFileSync as jest.Mock).mockImplementation(() => { throw new Error('ENOENT'); });
    const violations = rule.validate(ctx('/project/supabase/functions/my-function/index.ts'));
    expect(violations).toHaveLength(0);
  });
});
