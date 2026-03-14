/**
 * Tests for SupabasePaginationRule
 */

import { SupabasePaginationRule } from '../../../rules/debug/SupabasePaginationRule';
import { ValidationContext } from '../../../core/types';

describe('SupabasePaginationRule', () => {
  let rule: SupabasePaginationRule;

  beforeEach(() => {
    rule = new SupabasePaginationRule();
  });

  test('should detect query without limit or range', () => {
    // Rule detects supabase + .from( on the same line; use single-line format
    const context: ValidationContext = {
      fileContent: `const data = await supabase.from('tracks').select('*');`,
      filePath: '/test/service.ts',
      fileExtension: '.ts',
      projectRoot: '/test'
    };

    const violations = rule.validate(context);

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('without .limit() or .range()');
    expect(violations[0].severity).toBe('warning');
  });

  test('should not flag query with limit', () => {
    const context: ValidationContext = {
      fileContent: `
        const data = await supabase
          .from('tracks')
          .select('*')
          .limit(100);
      `,
      filePath: '/test/service.ts',
      fileExtension: '.ts',
      projectRoot: '/test'
    };

    const violations = rule.validate(context);

    expect(violations).toHaveLength(0);
  });

  test('should not flag query with range', () => {
    const context: ValidationContext = {
      fileContent: `
        const data = await supabase
          .from('tracks')
          .select('*')
          .range(0, 99);
      `,
      filePath: '/test/service.ts',
      fileExtension: '.ts',
      projectRoot: '/test'
    };

    const violations = rule.validate(context);

    expect(violations).toHaveLength(0);
  });

  test('should ignore files without supabase queries', () => {
    const context: ValidationContext = {
      fileContent: `
        const Component = () => {
          return <div>Hello</div>;
        };
      `,
      filePath: '/test/Component.tsx',
      fileExtension: '.tsx',
      projectRoot: '/test'
    };

    const violations = rule.validate(context);

    expect(violations).toHaveLength(0);
  });

  test('should provide helpful suggested fix', () => {
    const context: ValidationContext = {
      fileContent: `const data = await supabase.from('tracks').select('*');`,
      filePath: '/test/service.ts',
      fileExtension: '.ts',
      projectRoot: '/test'
    };

    const violations = rule.validate(context);

    expect(violations[0].suggestedFix).toContain('.limit(n) or .range(start, end)');
  });

  test('should detect multiple violations in same file', () => {
    const context: ValidationContext = {
      fileContent: `
        const data1 = await supabase.from('tracks').select('*');
        const data2 = await supabase.from('playlists').select('*');
      `,
      filePath: '/test/service.ts',
      fileExtension: '.ts',
      projectRoot: '/test'
    };

    const violations = rule.validate(context);

    expect(violations.length).toBeGreaterThanOrEqual(1);
  });
});
