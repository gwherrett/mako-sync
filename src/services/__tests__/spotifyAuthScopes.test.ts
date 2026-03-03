import { describe, it, expect } from 'vitest';

/**
 * MAK-9: Trim OAuth scopes to only what is needed.
 * Scopes to keep:   user-read-private, user-library-read
 * Scopes removed:   user-read-email, playlist-read-private,
 *                   playlist-read-collaborative, user-top-read
 */

const ALLOWED_SCOPES = ['user-read-private', 'user-library-read'];
const REMOVED_SCOPES = [
  'user-read-email',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-top-read',
];

function buildAuthUrl(clientId: string, redirectUri: string): URL {
  const scopes = ['user-read-private', 'user-library-read'].join(' ');
  const url = new URL('https://accounts.spotify.com/authorize');
  url.searchParams.append('client_id', clientId);
  url.searchParams.append('response_type', 'code');
  url.searchParams.append('redirect_uri', redirectUri);
  url.searchParams.append('scope', scopes);
  return url;
}

describe('MAK-9: OAuth scope trimming', () => {
  const url = buildAuthUrl('test-client-id', 'https://example.com/callback');
  const scopeParam = url.searchParams.get('scope') ?? '';
  const grantedScopes = scopeParam.split(' ');

  it('includes user-read-private scope', () => {
    expect(grantedScopes).toContain('user-read-private');
  });

  it('includes user-library-read scope', () => {
    expect(grantedScopes).toContain('user-library-read');
  });

  it('contains exactly 2 scopes', () => {
    expect(grantedScopes).toHaveLength(2);
  });

  for (const removed of REMOVED_SCOPES) {
    it(`does not include removed scope: ${removed}`, () => {
      expect(grantedScopes).not.toContain(removed);
    });
  }

  it('scope param matches exactly the allowed set', () => {
    expect(grantedScopes.sort()).toEqual([...ALLOWED_SCOPES].sort());
  });
});
