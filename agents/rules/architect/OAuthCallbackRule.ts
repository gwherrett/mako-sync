/**
 * Rule: OAuth Callback Flow
 * Detects incomplete OAuth flow implementation
 */

import { BaseRule } from '../../core/Rule';
import { RuleCategory, RuleSeverity, RuleViolation, ValidationContext } from '../../core/types';
import { hasIdentifier , getAST } from '../../core/ast-utils';
import * as ts from 'typescript';

export class OAuthCallbackRule extends BaseRule {
  constructor() {
    super({
      id: 'architect-003-oauth-callback',
      category: RuleCategory.AUTHENTICATION_FLOW,
      severity: RuleSeverity.ERROR,
      description: 'OAuth callback must include token exchange, session save, and error handling',
      rationale: 'Ensures complete and secure OAuth implementation',
      filePatterns: ['**/callback*.ts', '**/callback*.tsx', '**/oauth*.ts', '**/oauth*.tsx', '**/auth*.ts', '**/auth*.tsx'],
      excludePatterns: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/__tests__/**',
        '**/agents/**'
      ]
    });
  }

  validate(context: ValidationContext): RuleViolation[] {
    const violations: RuleViolation[] = [];
    const { fileContent, filePath } = context;

    // Only check files that appear to handle OAuth callbacks
    const isOAuthFile = /oauth|callback/i.test(filePath) || fileContent.includes('getSession') || fileContent.includes('exchangeCodeForSession');

    if (!isOAuthFile) {
      return violations;
    }

    try {
      const astContext = getAST(context);

      if (!astContext || !astContext.tsAst) {
        return violations;
      }

      // Check for required OAuth flow steps
      const requiredSteps = {
        tokenExchange: this.hasTokenExchange(fileContent, astContext.tsAst),
        sessionSave: this.hasSessionSave(fileContent, astContext.tsAst),
        errorHandling: this.hasErrorHandling(fileContent, astContext.tsAst)
      };

      // Check for missing steps
      if (!requiredSteps.tokenExchange) {
        violations.push(
          this.createViolation(
            context,
            'OAuth callback missing token exchange step',
            undefined,
            undefined,
            undefined,
            'Implement token exchange: await supabase.auth.exchangeCodeForSession(code)'
          )
        );
      }

      if (!requiredSteps.sessionSave) {
        violations.push(
          this.createViolation(
            context,
            'OAuth callback missing session save/persistence',
            undefined,
            undefined,
            undefined,
            'Save session after token exchange'
          )
        );
      }

      if (!requiredSteps.errorHandling) {
        violations.push(
          this.createViolation(
            context,
            'OAuth callback missing error handling',
            undefined,
            undefined,
            undefined,
            'Add try-catch block with proper error handling'
          )
        );
      }

      // Check for common OAuth security issues
      this.checkOAuthSecurity(context, fileContent, violations);

    } catch (error) {
      console.error(`Error in OAuthCallbackRule for ${filePath}:`, error);
    }

    return violations;
  }

  /**
   * Check if code has token exchange logic
   */
  private hasTokenExchange(content: string, ast?: ts.SourceFile): boolean {
    // Look for common token exchange patterns
    const patterns = [
      'exchangeCodeForSession',
      'getSessionFromUrl',
      'setSession',
      'getSession'
    ];

    return patterns.some(pattern => content.includes(pattern));
  }

  /**
   * Check if code has session save logic
   */
  private hasSessionSave(content: string, ast?: ts.SourceFile): boolean {
    // Look for session persistence patterns
    const patterns = [
      'setSession',
      'saveSession',
      'localStorage.setItem',
      'sessionStorage.setItem'
    ];

    // Supabase auth methods auto-persist sessions, so if the file is using
    // Supabase auth client and has token exchange, it's handling sessions correctly
    const hasSupabaseAuth = /supabase\.auth/.test(content);
    const hasTokenExchange = this.hasTokenExchange(content, ast);

    if (hasSupabaseAuth && hasTokenExchange) {
      return true; // Supabase handles session persistence automatically
    }

    return patterns.some(pattern => content.includes(pattern));
  }

  /**
   * Check if code has error handling
   */
  private hasErrorHandling(content: string, ast?: ts.SourceFile): boolean {
    // Look for error handling patterns
    const patterns = [
      'try',
      'catch',
      '.catch(',
      'if (error)',
      'if (!',
      'throw'
    ];

    return patterns.some(pattern => content.includes(pattern));
  }

  /**
   * Check for OAuth security issues
   */
  private checkOAuthSecurity(
    context: ValidationContext,
    content: string,
    violations: RuleViolation[]
  ): void {
    const lines = content.split('\n');

    // Check for state parameter validation (CSRF protection)
    const hasStateValidation = /state/.test(content) && /verify|validate|check/.test(content);

    if (!hasStateValidation && /callback/i.test(context.filePath)) {
      violations.push(
        this.createViolation(
          context,
          'OAuth callback should validate state parameter for CSRF protection',
          undefined,
          undefined,
          undefined,
          'Validate state parameter matches the one sent in authorization request'
        )
      );
    }

    // Check for redirect validation
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Only flag actual redirect operations, not just URL usage
      const isActualRedirect = (
        /window\.location\s*=/.test(line) || // Direct assignment
        /window\.location\.href\s*=/.test(line) || // href assignment
        /window\.location\.replace\(/.test(line) || // replace call
        /window\.location\.assign\(/.test(line) || // assign call
        /navigate\(/.test(line) || // navigate function
        /redirect\(/.test(line) // redirect function
      );

      const isJustReading = (
        /window\.location\.origin/.test(line) || // Reading origin
        /window\.location\.href/.test(line) && !/=/.test(line.split('window.location.href')[1]?.split(';')[0] || '') || // Reading href
        /url:\s*window\.location/.test(line) // Storing URL value
      );

      // Skip comments
      if (/^[\s]*\/\//.test(line)) {
        continue;
      }

      if (isActualRedirect && !isJustReading) {
        // Check if redirect URL is validated
        const surroundingLines = lines.slice(Math.max(0, i - 5), Math.min(lines.length, i + 5)).join('\n');

        if (!/validate|verify|whitelist|allowed/i.test(surroundingLines)) {
          const snippet = this.extractCodeSnippet(content, i + 1);
          violations.push(
            this.createViolation(
              context,
              'Redirect URL should be validated against whitelist',
              i + 1,
              undefined,
              snippet,
              'Validate redirect URL is in allowed list before redirecting'
            )
          );
          break; // Only report once
        }
      }
    }
  }
}
