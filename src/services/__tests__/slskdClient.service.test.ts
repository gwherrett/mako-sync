import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlskdClientService } from '../slskdClient.service';
import type { SlskdConfig, SlskdSearchResponse, SlskdTrackToSync } from '@/types/slskd';

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
      const searches = [{ id: '1', searchText: 'Artist - Title', state: 'Completed, TimedOut', isComplete: true }];
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

  describe('startSearch', () => {
    it('posts the search text', async () => {
      const created = { id: '9', searchText: 'Artist - Title', state: 'InProgress' };
      fetchMock.mockResolvedValue(mockResponse({ body: JSON.stringify(created) }));

      await expect(SlskdClientService.startSearch(config, 'Artist - Title')).resolves.toEqual(created);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://slskd.local:5030/api/v0/searches',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ searchText: 'Artist - Title' }) })
      );
    });
  });

  describe('startSearchUnlessDuplicate', () => {
    it('starts the search and adds it to the list', async () => {
      fetchMock.mockResolvedValue(
        mockResponse({ body: JSON.stringify({ id: 'abc', searchText: 'Bicep - Glue', state: 'InProgress' }) })
      );
      const saved: SlskdSearchResponse[] = [];

      await expect(SlskdClientService.startSearchUnlessDuplicate(config, saved, 'Bicep - Glue'))
        .resolves.toBe('started');
      expect(saved).toEqual([{ id: 'abc', searchText: 'Bicep - Glue', state: 'Requested' }]);
    });

    it('adds the search with an empty id when slskd returns no body', async () => {
      fetchMock.mockResolvedValue(mockResponse({ body: '' }));
      const saved: SlskdSearchResponse[] = [];

      await SlskdClientService.startSearchUnlessDuplicate(config, saved, 'Bicep - Glue');

      expect(saved).toEqual([{ id: '', searchText: 'Bicep - Glue', state: 'Requested' }]);
    });

    it('skips without calling slskd when the search is a duplicate', async () => {
      const saved = [{ id: '1', searchText: 'Bicep - Glue', state: 'Completed, ResponseLimitReached' }];

      await expect(SlskdClientService.startSearchUnlessDuplicate(config, saved, 'Bicep - Glue'))
        .resolves.toBe('skipped');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(saved).toHaveLength(1);
    });

    it('throws when slskd rejects the search, and leaves the list as it was', async () => {
      fetchMock.mockResolvedValue(mockResponse({ ok: false, status: 409, body: 'Not connected' }));
      const saved: SlskdSearchResponse[] = [];

      await expect(SlskdClientService.startSearchUnlessDuplicate(config, saved, 'Bicep - Glue'))
        .rejects.toThrow('slskd API error (409): Not connected');
      expect(saved).toEqual([]);
    });
  });

  describe('pushTracks', () => {
    const pushConfig = { ...config, searchFormat: 'primary' } as SlskdConfig;

    const moodymann: SlskdTrackToSync = { id: 's1', artist: 'Moodymann', title: 'Shades of Jae' };
    const kerri: SlskdTrackToSync = {
      id: 's2',
      artist: 'Kerri Chandler feat. Arnold Jarvis',
      primary_artist: 'Kerri Chandler',
      title: 'Rain',
    };

    /** slskd answers GET /api/v0/searches with savedSearches, and each POST with postReplies[searchText] or a new search */
    function slskdWith(savedSearches: unknown[], postReplies: Record<string, Response> = {}) {
      fetchMock.mockImplementation((_url: string, init: RequestInit) => {
        if (init.method === 'GET') {
          return Promise.resolve(mockResponse({ body: JSON.stringify(savedSearches) }));
        }
        const { searchText } = JSON.parse(String(init.body));
        return Promise.resolve(
          postReplies[searchText] ??
            mockResponse({ body: JSON.stringify({ id: `new ${searchText}`, searchText, state: 'InProgress' }) })
        );
      });
    }

    function postedSearchTexts(): string[] {
      return fetchMock.mock.calls
        .filter(([, init]) => init.method === 'POST')
        .map(([, init]) => JSON.parse(String(init.body)).searchText);
    }

    it('starts a search for each track, reading the saved searches once', async () => {
      slskdWith([]);
      const onProgress = vi.fn();

      const result = await SlskdClientService.pushTracks(pushConfig, [moodymann, kerri], onProgress, 0);

      expect(result).toEqual({ totalTracks: 2, addedCount: 2, skippedCount: 0, failedCount: 0, errors: [] });
      expect(postedSearchTexts()).toEqual(['Moodymann - Shades of Jae', 'Kerri Chandler - Rain']);
      expect(fetchMock.mock.calls.filter(([, init]) => init.method === 'GET')).toHaveLength(1);
      expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
        { current: 1, total: 2, currentTrack: 'Moodymann - Shades of Jae' },
        { current: 2, total: 2, currentTrack: 'Kerri Chandler - Rain' },
      ]);
    });

    it.each([
      'Requested',
      'Queued',
      'InProgress',
      'Completed, TimedOut',
      'Completed, ResponseLimitReached',
      'Completed, FileLimitReached',
    ])('skips a track whose saved search is "%s"', async (state) => {
      slskdWith([{ id: '1', searchText: 'Moodymann - Shades of Jae', state, isComplete: state.startsWith('Completed') }]);

      const result = await SlskdClientService.pushTracks(pushConfig, [moodymann], undefined, 0);

      expect(result).toMatchObject({ addedCount: 0, skippedCount: 1, failedCount: 0 });
      expect(postedSearchTexts()).toEqual([]);
    });

    it('skips a track whose saved search finished with no results', async () => {
      slskdWith([
        { id: '1', searchText: 'Moodymann - Shades of Jae', state: 'Completed, TimedOut', isComplete: true, responseCount: 0, fileCount: 0 },
      ]);

      const result = await SlskdClientService.pushTracks(pushConfig, [moodymann], undefined, 0);

      expect(result).toMatchObject({ addedCount: 0, skippedCount: 1 });
    });

    it.each(['Completed, Errored', 'Completed, Cancelled'])(
      'starts the search again after "%s"',
      async (state) => {
        slskdWith([{ id: '1', searchText: 'Moodymann - Shades of Jae', state, isComplete: true }]);

        const result = await SlskdClientService.pushTracks(pushConfig, [moodymann], undefined, 0);

        expect(result).toMatchObject({ addedCount: 1, skippedCount: 0, failedCount: 0 });
        expect(postedSearchTexts()).toEqual(['Moodymann - Shades of Jae']);
      }
    );

    it('skips a track that errored once and then finished on a retry', async () => {
      slskdWith([
        { id: '1', searchText: 'Moodymann - Shades of Jae', state: 'Completed, Errored' },
        { id: '2', searchText: 'Moodymann - Shades of Jae', state: 'Completed, TimedOut' },
      ]);

      const result = await SlskdClientService.pushTracks(pushConfig, [moodymann], undefined, 0);

      expect(result).toMatchObject({ addedCount: 0, skippedCount: 1 });
    });

    it('matches saved searches whatever their case and punctuation', async () => {
      slskdWith([{ id: '1', searchText: 'MOODYMANN – Shades Of Jae!', state: 'Completed, TimedOut' }]);

      const result = await SlskdClientService.pushTracks(pushConfig, [moodymann], undefined, 0);

      expect(result).toMatchObject({ addedCount: 0, skippedCount: 1 });
    });

    it('starts a search once when the push has the same track twice', async () => {
      slskdWith([]);

      const result = await SlskdClientService.pushTracks(
        pushConfig,
        [moodymann, { ...moodymann, id: 's9' }],
        undefined,
        0
      );

      expect(result).toMatchObject({ addedCount: 1, skippedCount: 1 });
      expect(postedSearchTexts()).toEqual(['Moodymann - Shades of Jae']);
    });

    it('counts a search slskd rejects as failed and carries on', async () => {
      slskdWith([], {
        'Moodymann - Shades of Jae': mockResponse({ ok: false, status: 409, body: 'Not logged in' }),
      });

      const result = await SlskdClientService.pushTracks(pushConfig, [moodymann, kerri], undefined, 0);

      expect(result).toEqual({
        totalTracks: 2,
        addedCount: 1,
        skippedCount: 0,
        failedCount: 1,
        errors: [{ track: 'Moodymann - Shades of Jae', error: 'slskd API error (409): Not logged in' }],
      });
      expect(postedSearchTexts()).toEqual(['Moodymann - Shades of Jae', 'Kerri Chandler - Rain']);
    });

    it('reports "Unknown error" when the failure is not an Error', async () => {
      fetchMock.mockImplementation((_url: string, init: RequestInit) =>
        init.method === 'GET'
          ? Promise.resolve(mockResponse({ body: '[]' }))
          : Promise.reject('connection reset')
      );

      const result = await SlskdClientService.pushTracks(pushConfig, [moodymann], undefined, 0);

      expect(result.errors).toEqual([{ track: 'Moodymann - Shades of Jae', error: 'Unknown error' }]);
    });

    it('rejects without starting any search when the saved searches cannot be read', async () => {
      fetchMock.mockResolvedValue(mockResponse({ ok: false, status: 500, body: 'Internal error' }));

      await expect(SlskdClientService.pushTracks(pushConfig, [moodymann], undefined, 0))
        .rejects.toThrow('slskd API error (500): Internal error');
      expect(postedSearchTexts()).toEqual([]);
    });

    it('waits 100ms after each search it starts, but not after a skip', async () => {
      slskdWith([{ id: '1', searchText: 'Kerri Chandler - Rain', state: 'Completed, TimedOut' }]);
      const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');

      await SlskdClientService.pushTracks(pushConfig, [moodymann, kerri]);

      expect(timeoutSpy.mock.calls.filter(([, ms]) => ms === 100)).toHaveLength(1);
      timeoutSpy.mockRestore();
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

  describe('searchStateFlags', () => {
    it.each([
      ['Completed, TimedOut', ['Completed', 'TimedOut']],
      ['Completed, ResponseLimitReached', ['Completed', 'ResponseLimitReached']],
      ['Completed,Errored', ['Completed', 'Errored']],
      ['InProgress', ['InProgress']],
      ['', []],
    ])('splits "%s"', (state, flags) => {
      expect(SlskdClientService.searchStateFlags(state)).toEqual(flags);
    });

    it('returns no flags when the state is missing', () => {
      expect(SlskdClientService.searchStateFlags(undefined)).toEqual([]);
      expect(SlskdClientService.searchStateFlags(null)).toEqual([]);
    });
  });

  describe('isSearchDuplicate — album searches', () => {
    const existingSearches: SlskdSearchResponse[] = [
      { id: '1', searchText: 'Bicep - Isles', state: 'InProgress' },
      { id: '2', searchText: 'Aphex Twin - Selected Ambient Works', state: 'Completed, ResponseLimitReached' },
      { id: '3', searchText: 'Boards of Canada - Music Has the Right to Children', state: 'Completed, Errored' },
    ];

    it('detects an InProgress album search as duplicate', () => {
      const searchText = SlskdClientService.formatAlbumSearchQuery('Bicep', 'Isles');
      expect(SlskdClientService.isSearchDuplicate(existingSearches, searchText)).toBe(true);
    });

    it('detects duplicate case-insensitively for album searches', () => {
      const searchText = SlskdClientService.formatAlbumSearchQuery('bicep', 'isles');
      expect(SlskdClientService.isSearchDuplicate(existingSearches, searchText)).toBe(true);
    });

    it('blocks a finished album search as duplicate', () => {
      const searchText = SlskdClientService.formatAlbumSearchQuery(
        'Aphex Twin',
        'Selected Ambient Works'
      );
      expect(SlskdClientService.isSearchDuplicate(existingSearches, searchText)).toBe(true);
    });

    it('does not flag an Errored album search as duplicate', () => {
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
    /** A saved search for "Artist - Title" in the given state */
    const savedAs = (state: string): SlskdSearchResponse[] => [{ id: '1', searchText: 'Artist - Title', state }];

    it.each([
      'Requested',
      'Queued',
      'InProgress',
      'Completed',
      'Completed, TimedOut',
      'Completed, ResponseLimitReached',
      'Completed, FileLimitReached',
    ])('blocks a search that is "%s"', (state) => {
      expect(SlskdClientService.isSearchDuplicate(savedAs(state), 'Artist - Title')).toBe(true);
    });

    it.each(['Completed, Cancelled', 'Completed, Errored'])('allows a retry after "%s"', (state) => {
      expect(SlskdClientService.isSearchDuplicate(savedAs(state), 'Artist - Title')).toBe(false);
    });

    it('blocks a search whose state it does not recognise', () => {
      expect(SlskdClientService.isSearchDuplicate(savedAs(''), 'Artist - Title')).toBe(true);
    });

    it('blocks when any saved search with the same text blocks', () => {
      const saved = [...savedAs('Completed, Errored'), ...savedAs('Queued')];
      expect(SlskdClientService.isSearchDuplicate(saved, 'Artist - Title')).toBe(true);
    });

    it('detects a duplicate case-insensitively', () => {
      expect(SlskdClientService.isSearchDuplicate(savedAs('InProgress'), 'ARTIST - TITLE')).toBe(true);
    });

    it('returns false for non-duplicate', () => {
      expect(SlskdClientService.isSearchDuplicate(savedAs('Completed, TimedOut'), 'New Artist - New Song')).toBe(false);
    });

    it('handles empty existing searches', () => {
      expect(SlskdClientService.isSearchDuplicate([], 'Artist - Title')).toBe(false);
    });
  });
});
