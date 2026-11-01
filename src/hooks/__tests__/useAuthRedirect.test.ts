import { describe, it, expect } from 'vitest';
import { getSafeReturnTo } from '@/hooks/useAuthRedirect';

// ─── getSafeReturnTo — accepted paths ─────────────────────────────────────────

describe('getSafeReturnTo — app-relative paths are kept', () => {
  it.each([
    '/',
    '/genre-mapping',
    '/no-genre-tracks',
    '/security',
    '/vinyl/123',
  ])('keeps %s', (path) => {
    expect(getSafeReturnTo(path, '/')).toBe(path);
  });

  it('keeps the query string and hash', () => {
    expect(getSafeReturnTo('/genre-mapping?tab=overrides#top', '/')).toBe('/genre-mapping?tab=overrides#top');
  });

  it('keeps an encoded slash as part of the path rather than a new host', () => {
    expect(getSafeReturnTo('/%2F%2Fevil.com', '/')).toBe('/%2F%2Fevil.com');
  });
});

// ─── getSafeReturnTo — rejected values ────────────────────────────────────────

describe('getSafeReturnTo — values that would leave the app fall back', () => {
  it.each([
    ['protocol-relative', '//evil.com'],
    ['triple slash', '///evil.com'],
    ['slash-backslash', '/\\evil.com'],
    ['leading backslash', '\\evil.com'],
    ['absolute https URL', 'https://evil.com'],
    ['javascript: URL', 'javascript:alert(1)'],
    ['tab between slashes', '/\t/evil.com'],
    ['newline between slashes', '/\n/evil.com'],
    ['relative path', 'genre-mapping'],
    ['empty string', ''],
  ])('rejects %s (%j)', (_label, value) => {
    expect(getSafeReturnTo(value, '/')).toBe('/');
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['an object', { pathname: '/genre-mapping' }],
  ])('rejects %s', (_label, value) => {
    expect(getSafeReturnTo(value, '/')).toBe('/');
  });

  it('returns the caller-supplied fallback', () => {
    expect(getSafeReturnTo('//evil.com', '/dashboard')).toBe('/dashboard');
  });
});
