/**
 * Tests for ServiceLayerRule
 */

import { ServiceLayerRule } from '../../../rules/code/ServiceLayerRule';
import { ValidationContext } from '../../../core/types';

const makeContext = (fileContent: string): ValidationContext => ({
  fileContent,
  filePath: '/src/components/MyComponent.tsx',
  fileExtension: '.tsx',
  projectRoot: '/src',
});

describe('ServiceLayerRule', () => {
  let rule: ServiceLayerRule;

  beforeEach(() => {
    rule = new ServiceLayerRule();
  });

  describe('supabase.from() direct queries', () => {
    it('flags direct supabase.from() in a component', () => {
      const violations = rule.validate(
        makeContext(`const { data } = await supabase.from('tracks').select('*');`)
      );
      expect(violations).toHaveLength(1);
      expect(violations[0].ruleId).toBe('code-001-service-layer');
    });

    it('does not flag supabase.from() in a comment', () => {
      const violations = rule.validate(
        makeContext(`// const { data } = await supabase.from('tracks').select('*');`)
      );
      expect(violations).toHaveLength(0);
    });
  });

  describe('supabase.rpc() direct calls', () => {
    it('flags direct supabase.rpc() in a component', () => {
      const violations = rule.validate(
        makeContext(`const result = await supabase.rpc('my_function');`)
      );
      expect(violations).toHaveLength(1);
    });
  });

  describe('supabase.auth.* direct calls', () => {
    it('flags supabase.auth.signOut() — not an allowed auth call', () => {
      const violations = rule.validate(
        makeContext(`await supabase.auth.signOut();`)
      );
      expect(violations).toHaveLength(1);
    });

    it('flags supabase.auth.signUp() — not an allowed auth call', () => {
      const violations = rule.validate(
        makeContext(`await supabase.auth.signUp({ email, password });`)
      );
      expect(violations).toHaveLength(1);
    });

    it('does not flag supabase.auth.getSession() — allowed in components', () => {
      const violations = rule.validate(
        makeContext(`const { data } = await supabase.auth.getSession();`)
      );
      expect(violations).toHaveLength(0);
    });

    it('does not flag supabase.auth.onAuthStateChange() — allowed in components', () => {
      const violations = rule.validate(
        makeContext(`supabase.auth.onAuthStateChange((event, session) => {});`)
      );
      expect(violations).toHaveLength(0);
    });

    it('does not flag supabase.auth.* in a comment', () => {
      const violations = rule.validate(
        makeContext(`// supabase.auth.signOut()`)
      );
      expect(violations).toHaveLength(0);
    });
  });

  describe('files without supabase', () => {
    it('ignores files with no supabase usage', () => {
      const violations = rule.validate(
        makeContext(`const Component = () => <div>Hello</div>;`)
      );
      expect(violations).toHaveLength(0);
    });
  });

  describe('file pattern filtering', () => {
    it('does not apply to service files', () => {
      const context: ValidationContext = {
        fileContent: `const { data } = await supabase.from('tracks').select('*');`,
        filePath: '/src/services/tracks.service.ts',
        fileExtension: '.ts',
        projectRoot: '/src',
      };
      expect(rule.appliesTo(context.filePath)).toBe(false);
    });

    it('applies to component files (with subdirectory)', () => {
      // Pattern **/components/**/*.tsx requires a subdirectory under components/
      expect(rule.appliesTo('/src/components/common/MyComponent.tsx')).toBe(true);
    });

    it('applies to page files (with subdirectory)', () => {
      // Pattern **/pages/**/*.tsx requires a subdirectory under pages/
      expect(rule.appliesTo('/src/pages/home/Index.tsx')).toBe(true);
    });
  });
});
