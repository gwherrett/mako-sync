import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { getFieldError } from '@/hooks/useRealTimeValidation';

// Schemas built the same way as the auth forms (NewAuth.tsx, ResetPassword.tsx)
const emailSchema = z.string()
  .trim()
  .min(1, 'Email is required')
  .email('Please enter a valid email address')
  .max(255, 'Email address is too long');

const passwordSchema = z.string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/^(?=.*[A-Z])/, 'Password must contain at least one uppercase letter')
  .regex(/^(?=.*\d)/, 'Password must contain at least one number');

// ─── getFieldError — messages ─────────────────────────────────────────────────

describe('getFieldError — returns the first issue message', () => {
  it('returns null for a valid value', () => {
    expect(getFieldError(passwordSchema, 'Abcdefg1')).toBeNull();
  });

  it('returns the message of the first failing check', () => {
    expect(getFieldError(passwordSchema, 'abc')).toBe('Password must be at least 8 characters');
  });

  it('returns a later check message once earlier checks pass', () => {
    expect(getFieldError(passwordSchema, 'abcdefgh1')).toBe('Password must contain at least one uppercase letter');
  });

  it('returns a refine message', () => {
    const schema = z.string().refine((v) => v.length !== 1, 'Display name must be at least 2 characters if provided');
    expect(getFieldError(schema, 'a')).toBe('Display name must be at least 2 characters if provided');
  });

  it('falls back to "Invalid value" when a refine throws a non-Zod error', () => {
    const schema = z.string().refine(() => { throw new Error('boom'); });
    expect(getFieldError(schema, 'x')).toBe('Invalid value');
  });
});

// ─── getFieldError — email check under zod 4 ──────────────────────────────────

describe('getFieldError — zod 4 email validation', () => {
  it.each([
    'user@example.com',
    'user+tag@sub.example.co.uk',
    'first.last@example.museum',
    "o'brien@example.ie",
    'UPPER@EXAMPLE.COM',
    '  padded@example.com  ',
  ])('accepts %s', (email) => {
    expect(getFieldError(emailSchema, email)).toBeNull();
  });

  it.each([
    'a@b',
    'user@localhost',
    '.user@example.com',
    'user..name@example.com',
  ])('rejects %s', (email) => {
    expect(getFieldError(emailSchema, email)).toBe('Please enter a valid email address');
  });

  it('reports a missing email before the format check', () => {
    expect(getFieldError(emailSchema, '   ')).toBe('Email is required');
  });
});
