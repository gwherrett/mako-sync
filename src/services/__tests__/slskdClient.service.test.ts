import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlskdClientService } from '../slskdClient.service';
import type { SlskdConfig } from '@/types/slskd';

const config = { apiEndpoint: 'http://slskd.local:5030', apiKey: 'key-123' } as SlskdConfig;

function mockResponse(init: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  body?: string;
  contentType?: string | null;
  json?: unknown;
  jsonRejects?: Error;
  textRejects?: boolean;
}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    headers: { get: () => init.contentType ?? null },
    text: init.textRejects
      ? () => Promise.reject(new Error('stream error'))
      : () => Promise.resolve(init.body ?? ''),
    json: init.jsonRejects
      ? () => Promise.reject(init.jsonRejects)
      : () => Promise.resolve(init.json),
  } as unknown as Response;
}

/** A GET /api/v0/application reply with the given Soulseek server state */
function applicationResponse(server: unknown): Response {
  return mockResponse({ contentType: 'application/json; charset=utf-8', json: { version: { current: '0.26.2' }, server } });
}

describe('SlskdClientService HTTP calls', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    fetchMock.mockReset();
  });

  describe('testConnection', () => {
    it('returns connected when slskd is connected and logged in to Soulseek', async () => {
      fetchMock.mockResolvedValue(
        applicationResponse({ state: 'Connected, LoggedIn', isConnected: true, isLoggedIn: true })
      );

      await expect(SlskdClientService.testConnection(config)).resolves.toEqual({ status: 'connected' });
      expect(fetchMock).toHaveBeenCalledWith(
        'http://slskd.local:5030/api/v0/application',
        expect.objectContaining({ method: 'GET', headers: { 'X-API-Key': 'key-123' } })
      );
    });

    it('keeps the 10 second timeout', async () => {
      const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
      fetchMock.mockResolvedValue(
        applicationResponse({ state: 'Connected, LoggedIn', isConnected: true, isLoggedIn: true })
      );

      await SlskdClientService.testConnection(config);

      expect(timeoutSpy).toHaveBeenCalledWith(10000);
      expect(fetchMock.mock.calls[0][1].signal).toBe(timeoutSpy.mock.results[0].value);
      timeoutSpy.mockRestore();
    });

    it('returns not-logged-in when slskd is disconnected from Soulseek', async () => {
      fetchMock.mockResolvedValue(
        applicationResponse({ state: 'Disconnected', isConnected: false, isLoggedIn: false })
      );

      await expect(SlskdClientService.testConnection(config))
        .resolves.toEqual({ status: 'not-logged-in', serverState: 'Disconnected' });
    });

    it('returns not-logged-in when slskd is connected to the server but not logged in', async () => {
      fetchMock.mockResolvedValue(
        applicationResponse({ state: 'Connected, LoggingIn', isConnected: true, isLoggedIn: false })
      );

      await expect(SlskdClientService.testConnection(config))
        .resolves.toEqual({ status: 'not-logged-in', serverState: 'Connected, LoggingIn' });
    });

    it('requires isConnected as well as isLoggedIn', async () => {
      fetchMock.mockResolvedValue(applicationResponse({ isConnected: false, isLoggedIn: true }));

      await expect(SlskdClientService.testConnection(config))
        .resolves.toEqual({ status: 'not-logged-in', serverState: null });
    });

    it('returns unauthorized for a 401', async () => {
      fetchMock.mockResolvedValue(mockResponse({ ok: false, status: 401, statusText: 'Unauthorized' }));

      await expect(SlskdClientService.testConnection(config)).resolves.toEqual({ status: 'unauthorized' });
    });

    it('returns unreachable (network) when fetch fails', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(SlskdClientService.testConnection(config))
        .resolves.toEqual({ status: 'unreachable', reason: 'network' });
    });

    it('returns unreachable (timeout) when the request times out', async () => {
      fetchMock.mockRejectedValue(
        new DOMException('The operation was aborted due to timeout', 'TimeoutError')
      );

      await expect(SlskdClientService.testConnection(config))
        .resolves.toEqual({ status: 'unreachable', reason: 'timeout' });
    });

    it('returns unreachable (timeout) when the request is aborted', async () => {
      fetchMock.mockRejectedValue(new DOMException('The user aborted a request.', 'AbortError'));

      await expect(SlskdClientService.testConnection(config))
        .resolves.toEqual({ status: 'unreachable', reason: 'timeout' });
    });

    it('returns unreachable (timeout) when the body times out', async () => {
      fetchMock.mockResolvedValue(
        mockResponse({
          contentType: 'application/json',
          jsonRejects: new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
        })
      );

      await expect(SlskdClientService.testConnection(config))
        .resolves.toEqual({ status: 'unreachable', reason: 'timeout' });
    });

    it('returns unexpected-response for another error status', async () => {
      fetchMock.mockResolvedValue(mockResponse({ ok: false, status: 500, statusText: 'Internal Server Error' }));

      await expect(SlskdClientService.testConnection(config))
        .resolves.toEqual({ status: 'unexpected-response', detail: 'HTTP 500' });
    });

    it('returns unexpected-response when the response is not JSON', async () => {
      fetchMock.mockResolvedValue(mockResponse({ contentType: 'text/html' }));

      await expect(SlskdClientService.testConnection(config))
        .resolves.toEqual({ status: 'unexpected-response', detail: 'content type text/html' });
    });

    it('returns unexpected-response when there is no content type', async () => {
      fetchMock.mockResolvedValue(mockResponse({ contentType: null }));

      await expect(SlskdClientService.testConnection(config))
        .resolves.toEqual({ status: 'unexpected-response', detail: 'content type missing' });
    });

    it('returns unexpected-response for invalid JSON', async () => {
      fetchMock.mockResolvedValue(
        mockResponse({ contentType: 'application/json', jsonRejects: new SyntaxError('Unexpected token') })
      );

      await expect(SlskdClientService.testConnection(config))
        .resolves.toEqual({ status: 'unexpected-response', detail: 'invalid JSON' });
    });

    it.each([
      ['no server field', { version: '1' }],
      ['a null body', null],
      ['a server field without isLoggedIn', { server: { state: 'Connected' } }],
    ])('returns unexpected-response for JSON with %s', async (_label, json) => {
      fetchMock.mockResolvedValue(mockResponse({ contentType: 'application/json', json }));

      await expect(SlskdClientService.testConnection(config))
        .resolves.toEqual({ status: 'unexpected-response', detail: 'no Soulseek server state' });
    });
  });

  describe('getExistingSearches', () => {
    it('sends the API key and parses the JSON body', async () => {
      const searches = [{ id: '1', searchText: 'Artist - Title', state: 'Completed' }];
      fetchMock.mockResolvedValue(mockResponse({ body: JSON.stringify(searches) }));

      await expect(SlskdClientService.getExistingSearches(config)).resolves.toEqual(searches);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://slskd.local:5030/api/v0/searches',
        expect.objectContaining({
          method: 'GET',
          headers: { 'X-API-Key': 'key-123', 'Content-Type': 'application/json' },
        })
      );
    });

    it('returns an empty object for an empty body', async () => {
      fetchMock.mockResolvedValue(mockResponse({ body: '' }));

      await expect(SlskdClientService.getExistingSearches(config)).resolves.toEqual({});
    });

    it('throws with the status and body text for an error response', async () => {
      fetchMock.mockResolvedValue(mockResponse({ ok: false, status: 500, body: 'Internal error' }));

      await expect(SlskdClientService.getExistingSearches(config))
        .rejects.toThrow('slskd API error (500): Internal error');
    });

    it('falls back to "Unknown error" when the error body cannot be read', async () => {
      fetchMock.mockResolvedValue(mockResponse({ ok: false, status: 502, textRejects: true }));

      await expect(SlskdClientService.getExistingSearches(config))
        .rejects.toThrow('slskd API error (502): Unknown error');
    });
  });

  describe('addToWishlist', () => {
    it('posts the search text', async () => {
      const created = { id: '9', searchText: 'Artist - Title', state: 'InProgress' };
      fetchMock.mockResolvedValue(mockResponse({ body: JSON.stringify(created) }));

      await expect(SlskdClientService.addToWishlist(config, 'Artist - Title')).resolves.toEqual(created);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://slskd.local:5030/api/v0/searches',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ searchText: 'Artist - Title' }) })
      );
    });
  });
});

describe('SlskdClientService', () => {
  describe('formatSearchQuery', () => {
    it('uses primary artist only when format is primary', () => {
      expect(
        SlskdClientService.formatSearchQuery('Artist1, Artist2', 'Title', 'primary')
      ).toBe('Artist1 - Title');
    });

    it('uses full artist when format is full', () => {
      expect(
        SlskdClientService.formatSearchQuery('Artist1, Artist2', 'Title', 'full')
      ).toBe('Artist1, Artist2 - Title');
    });

    it('strips feat. from primary artist', () => {
      expect(
        SlskdClientService.formatSearchQuery('Artist feat. Other', 'Title', 'primary')
      ).toBe('Artist - Title');
    });

    it('strips ft. from primary artist', () => {
      expect(
        SlskdClientService.formatSearchQuery('Artist ft. Other', 'Title', 'primary')
      ).toBe('Artist - Title');
    });

    it('handles "feat" without period', () => {
      expect(
        SlskdClientService.formatSearchQuery('Artist feat Other', 'Title', 'primary')
      ).toBe('Artist - Title');
    });

    it('does not include bitrate in query', () => {
      expect(
        SlskdClientService.formatSearchQuery('Artist', 'Title', 'primary')
      ).not.toContain('320');
      expect(
        SlskdClientService.formatSearchQuery('Artist', 'Title', 'primary')
      ).not.toContain('MP3');
    });

    it('sanitizes quotes from artist', () => {
      expect(
        SlskdClientService.formatSearchQuery('"Artist"', 'Title', 'primary')
      ).toBe('Artist - Title');
    });

    it('sanitizes quotes from title', () => {
      expect(
        SlskdClientService.formatSearchQuery('Artist', '"Title"', 'primary')
      ).toBe('Artist - Title');
    });

    it('defaults to primary format', () => {
      expect(SlskdClientService.formatSearchQuery('Artist1, Artist2', 'Title')).toBe(
        'Artist1 - Title'
      );
    });

    it('handles complex artist strings', () => {
      expect(
        SlskdClientService.formatSearchQuery(
          'Main Artist feat. Featured Artist, Another Artist',
          'Song Title',
          'primary'
        )
      ).toBe('Main Artist - Song Title');
    });
  });

  describe('normalizeSearchText', () => {
    it('converts to lowercase', () => {
      expect(SlskdClientService.normalizeSearchText('ARTIST - TITLE')).toBe(
        'artist title'
      );
    });

    it('removes special characters', () => {
      expect(SlskdClientService.normalizeSearchText("Artist's Song!")).toBe(
        'artists song'
      );
    });

    it('normalizes whitespace', () => {
      expect(SlskdClientService.normalizeSearchText('Artist  -  Title')).toBe(
        'artist title'
      );
    });

    it('trims whitespace', () => {
      expect(SlskdClientService.normalizeSearchText('  Artist - Title  ')).toBe(
        'artist title'
      );
    });
  });

  describe('formatAlbumSearchQuery', () => {
    it('formats album with primary artist only by default', () => {
      expect(
        SlskdClientService.formatAlbumSearchQuery('Bicep', 'Isles')
      ).toBe('Bicep - Isles');
    });

    it('uses primary artist only when format is primary', () => {
      expect(
        SlskdClientService.formatAlbumSearchQuery('Artist1, Artist2', 'Album Title', 'primary')
      ).toBe('Artist1 - Album Title');
    });

    it('uses full artist when format is full', () => {
      expect(
        SlskdClientService.formatAlbumSearchQuery('Artist1, Artist2', 'Album Title', 'full')
      ).toBe('Artist1, Artist2 - Album Title');
    });

    it('strips feat. from primary artist', () => {
      expect(
        SlskdClientService.formatAlbumSearchQuery('Artist feat. Other', 'Album', 'primary')
      ).toBe('Artist - Album');
    });

    it('strips ft. from primary artist', () => {
      expect(
        SlskdClientService.formatAlbumSearchQuery('Artist ft. Other', 'Album', 'primary')
      ).toBe('Artist - Album');
    });

    it('sanitizes quotes from artist', () => {
      expect(
        SlskdClientService.formatAlbumSearchQuery('"Artist"', 'Album', 'primary')
      ).toBe('Artist - Album');
    });

    it('sanitizes quotes from album name', () => {
      expect(
        SlskdClientService.formatAlbumSearchQuery('Artist', '"Album Name"', 'primary')
      ).toBe('Artist - Album Name');
    });

    it('handles complex artist with feat. and comma', () => {
      expect(
        SlskdClientService.formatAlbumSearchQuery(
          'Main Artist feat. Featured, Another',
          'Collab Album',
          'primary'
        )
      ).toBe('Main Artist - Collab Album');
    });
  });

  describe('isSearchDuplicate — album searches', () => {
    const existingSearches = [
      { id: '1', searchText: 'Bicep - Isles', state: 'InProgress' as const },
      { id: '2', searchText: 'Aphex Twin - Selected Ambient Works', state: 'Completed' as const },
      { id: '3', searchText: 'Boards of Canada - Music Has the Right to Children', state: 'TimedOut' as const },
    ];

    it('detects an InProgress album search as duplicate', () => {
      const searchText = SlskdClientService.formatAlbumSearchQuery('Bicep', 'Isles');
      expect(SlskdClientService.isSearchDuplicate(existingSearches, searchText)).toBe(true);
    });

    it('detects duplicate case-insensitively for album searches', () => {
      const searchText = SlskdClientService.formatAlbumSearchQuery('bicep', 'isles');
      expect(SlskdClientService.isSearchDuplicate(existingSearches, searchText)).toBe(true);
    });

    it('blocks a Completed album search as duplicate', () => {
      const searchText = SlskdClientService.formatAlbumSearchQuery(
        'Aphex Twin',
        'Selected Ambient Works'
      );
      expect(SlskdClientService.isSearchDuplicate(existingSearches, searchText)).toBe(true);
    });

    it('does not flag a TimedOut album search as duplicate', () => {
      const searchText = SlskdClientService.formatAlbumSearchQuery(
        'Boards of Canada',
        'Music Has the Right to Children'
      );
      expect(SlskdClientService.isSearchDuplicate(existingSearches, searchText)).toBe(false);
    });

    it('returns false for a new album search not in the list', () => {
      const searchText = SlskdClientService.formatAlbumSearchQuery('Burial', 'Untrue');
      expect(SlskdClientService.isSearchDuplicate(existingSearches, searchText)).toBe(false);
    });

    it('detects InProgress album search with full format', () => {
      const searchText = SlskdClientService.formatAlbumSearchQuery('Bicep', 'Isles', 'full');
      expect(SlskdClientService.isSearchDuplicate(existingSearches, searchText)).toBe(true);
    });
  });

  describe('isSearchDuplicate', () => {
    const existingSearches = [
      { id: '1', searchText: 'Artist - Title', state: 'Completed' as const },
      { id: '2', searchText: 'Another Artist - Another Song', state: 'InProgress' as const },
      { id: '3', searchText: 'Timed Out Artist - Song', state: 'TimedOut' as const },
      { id: '4', searchText: 'Cancelled Artist - Song', state: 'Cancelled' as const },
      { id: '5', searchText: 'Errored Artist - Song', state: 'Errored' as const },
    ];

    it('blocks a Completed search as duplicate', () => {
      expect(
        SlskdClientService.isSearchDuplicate(existingSearches, 'Artist - Title')
      ).toBe(true);
    });

    it('detects InProgress search as duplicate', () => {
      expect(
        SlskdClientService.isSearchDuplicate(existingSearches, 'Another Artist - Another Song')
      ).toBe(true);
    });

    it('detects InProgress duplicate case-insensitively', () => {
      expect(
        SlskdClientService.isSearchDuplicate(existingSearches, 'ANOTHER ARTIST - ANOTHER SONG')
      ).toBe(true);
    });

    it('returns false for TimedOut search', () => {
      expect(
        SlskdClientService.isSearchDuplicate(existingSearches, 'Timed Out Artist - Song')
      ).toBe(false);
    });

    it('returns false for Cancelled search', () => {
      expect(
        SlskdClientService.isSearchDuplicate(existingSearches, 'Cancelled Artist - Song')
      ).toBe(false);
    });

    it('returns false for Errored search (allows retry)', () => {
      expect(
        SlskdClientService.isSearchDuplicate(existingSearches, 'Errored Artist - Song')
      ).toBe(false);
    });

    it('returns false for non-duplicate', () => {
      expect(
        SlskdClientService.isSearchDuplicate(existingSearches, 'New Artist - New Song')
      ).toBe(false);
    });

    it('handles empty existing searches', () => {
      expect(SlskdClientService.isSearchDuplicate([], 'Artist - Title')).toBe(false);
    });
  });
});
