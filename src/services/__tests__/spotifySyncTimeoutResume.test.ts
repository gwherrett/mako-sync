import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: invokeMock } },
}));

vi.mock('@/services/sessionCache.service', () => ({
  sessionCache: { getSession: vi.fn().mockResolvedValue({ session: { access_token: 'session-token' } }) },
}));

import { SpotifyAuthManager, isFunctionTimeout } from '@/services/spotifyAuthManager.service';

const clientAbort = () => new FunctionsFetchError(new DOMException('The operation was aborted.', 'AbortError'));
const httpError = (status: number, body: object = {}) =>
  new FunctionsHttpError(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

describe('isFunctionTimeout', () => {
  it('is true when the client aborts the request', () => {
    expect(isFunctionTimeout(clientAbort())).toBe(true);
  });

  it('is true when Supabase cuts the function off', () => {
    expect(isFunctionTimeout(httpError(504))).toBe(true);
    expect(isFunctionTimeout(httpError(546))).toBe(true);
  });

  it('is false for network failures and other errors', () => {
    expect(isFunctionTimeout(new FunctionsFetchError(new TypeError('Failed to fetch')))).toBe(false);
    expect(isFunctionTimeout(httpError(500))).toBe(false);
    expect(isFunctionTimeout(new Error('boom'))).toBe(false);
    expect(isFunctionTimeout(undefined)).toBe(false);
  });
});

describe('SpotifyAuthManager.syncLikedSongs — resume after timeout', () => {
  const timedOut = () => ({ data: null, error: clientAbort() });
  const partial = { data: { success: true, partial: true, resume_offset: 500 }, error: null };
  const completed = { data: { success: true, message: 'Full sync complete: 1200 tracks synced' }, error: null };

  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('resumes after a timeout and completes', async () => {
    invokeMock.mockResolvedValueOnce(timedOut()).mockResolvedValueOnce(completed);

    const result = await SpotifyAuthManager.getInstance().syncLikedSongs(true);

    expect(result.success).toBe(true);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('stops with a clear error after two timeouts in a row', async () => {
    invokeMock.mockResolvedValue(timedOut());

    const result = await SpotifyAuthManager.getInstance().syncLikedSongs(true);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timed out/i);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('resets the timeout count after a partial response', async () => {
    invokeMock
      .mockResolvedValueOnce(timedOut())
      .mockResolvedValueOnce(partial)
      .mockResolvedValueOnce(timedOut())
      .mockResolvedValueOnce(completed);

    const result = await SpotifyAuthManager.getInstance().syncLikedSongs(true);

    expect(result.success).toBe(true);
    expect(invokeMock).toHaveBeenCalledTimes(4);
  });

  it('does not retry errors that are not timeouts', async () => {
    invokeMock.mockResolvedValueOnce({ data: null, error: httpError(400, { error: 'Spotify not connected' }) });

    const result = await SpotifyAuthManager.getInstance().syncLikedSongs(true);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Spotify not connected');
    expect(invokeMock).toHaveBeenCalledOnce();
  });
});
