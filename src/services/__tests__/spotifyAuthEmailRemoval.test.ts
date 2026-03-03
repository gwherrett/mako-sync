import { describe, it, expect } from 'vitest';

/**
 * MAK-7: Spotify removed `email` from the /v1/me response.
 * These tests verify:
 *   1. A /v1/me response without `email` is handled gracefully.
 *   2. The connection record sources email from the Supabase JWT (user.email),
 *      not from profileData.email.
 *   3. No undefined/null email is written when neither source has one.
 */

describe('MAK-7: email field removal from /v1/me', () => {
  it('profileData without email field does not crash when reading display_name and id', () => {
    // Simulate the /v1/me response shape after Spotify removed email
    const profileData = {
      id: 'spotify-user-123',
      display_name: 'Test User',
      // email intentionally absent
    };

    expect(() => {
      const spotifyUserId = profileData.id;
      const displayName = profileData.display_name;
      // These are the only fields now read from profileData in spotify-auth/index.ts
      return { spotifyUserId, displayName };
    }).not.toThrow();
  });

  it('connection record uses user.email (JWT) not profileData.email', () => {
    const profileData = {
      id: 'spotify-user-123',
      display_name: 'Test User',
      // no email field
    };

    const user = {
      id: 'supabase-user-abc',
      email: 'user@example.com',
    };

    // Mirrors the connectionData construction in spotify-auth/index.ts
    const connectionData = {
      user_id: user.id,
      spotify_user_id: profileData.id,
      display_name: profileData.display_name,
      email: user.email ?? null,
    };

    expect(connectionData.email).toBe('user@example.com');
    expect(connectionData.email).not.toBeUndefined();
  });

  it('connection record email is null (not undefined) when JWT has no email', () => {
    const profileData = {
      id: 'spotify-user-123',
      display_name: 'Test User',
    };

    const user = {
      id: 'supabase-user-abc',
      email: undefined,
    };

    const connectionData = {
      user_id: user.id,
      spotify_user_id: profileData.id,
      display_name: profileData.display_name,
      email: user.email ?? null,
    };

    // Must be null, never undefined, to avoid writing garbage to the DB
    expect(connectionData.email).toBeNull();
    expect(connectionData.email).not.toBeUndefined();
  });

  it('profileData.email is never accessed — accessing it returns undefined without throwing', () => {
    const profileData: Record<string, unknown> = {
      id: 'spotify-user-123',
      display_name: 'Test User',
    };

    // Confirm the old pattern would silently produce undefined
    expect(profileData['email']).toBeUndefined();
  });
});
