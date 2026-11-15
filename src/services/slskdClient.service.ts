/**
 * slskd Client Service
 *
 * Handles all communication with the slskd REST API.
 * slskd is a Soulseek client with a web interface and API.
 */

import type {
  SlskdApplicationResponse,
  SlskdConfig,
  SlskdConnectionResult,
  SlskdPushProgress,
  SlskdSearchResponse,
  SlskdSearchStateFlag,
  SlskdSyncResult,
  SlskdTrackToSync,
} from '@/types/slskd';

const CONNECTION_TEST_TIMEOUT_MS = 10000;

/** Gap between searches in a push */
const PUSH_DELAY_MS = 100;

/** A saved search with one of these flags can be pushed again */
const RETRYABLE_SEARCH_FLAGS: readonly SlskdSearchStateFlag[] = ['Cancelled', 'Errored'];

/**
 * AbortSignal.timeout() rejects with a TimeoutError DOMException. Some browsers report AbortError.
 */
function isTimeoutError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

export class SlskdClientService {
  /**
   * Make an authenticated request to slskd API
   */
  private static async request<T>(
    config: SlskdConfig,
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${config.apiEndpoint}${endpoint}`;
    const headers = {
      'X-API-Key': config.apiKey,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const response = await fetch(url, {
      ...options,
      headers,
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (!response.ok) {
      const errorMessage = await response.text().catch(() => 'Unknown error');
      throw new Error(`slskd API error (${response.status}): ${errorMessage}`);
    }

    // Handle empty responses
    const text = await response.text();
    if (!text) {
      return {} as T;
    }

    return JSON.parse(text);
  }

  /**
   * Test connection to slskd instance.
   *
   * Reads server.isConnected and server.isLoggedIn from GET /api/v0/application, so
   * "connected" means pushed searches will reach the Soulseek network, not just that
   * the slskd API answered. See docs/reference/slskd.md, answer 4.
   */
  static async testConnection(config: SlskdConfig): Promise<SlskdConnectionResult> {
    let response: Response;
    try {
      response = await fetch(`${config.apiEndpoint}/api/v0/application`, {
        method: 'GET',
        headers: {
          'X-API-Key': config.apiKey,
        },
        signal: AbortSignal.timeout(CONNECTION_TEST_TIMEOUT_MS),
      });
    } catch (error) {
      console.error('slskd connection test failed:', error);
      return { status: 'unreachable', reason: isTimeoutError(error) ? 'timeout' : 'network' };
    }

    if (response.status === 401) {
      return { status: 'unauthorized' };
    }

    if (!response.ok) {
      console.error('slskd connection test failed:', response.status, response.statusText);
      return { status: 'unexpected-response', detail: `HTTP ${response.status}` };
    }

    // A wrong endpoint can return the app's own HTML page instead of slskd's JSON
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      console.error('slskd returned non-JSON response:', contentType);
      return { status: 'unexpected-response', detail: `content type ${contentType ?? 'missing'}` };
    }

    let data: SlskdApplicationResponse | null;
    try {
      data = await response.json();
    } catch (error) {
      console.error('slskd returned unreadable JSON:', error);
      if (isTimeoutError(error)) {
        return { status: 'unreachable', reason: 'timeout' };
      }
      return { status: 'unexpected-response', detail: 'invalid JSON' };
    }

    const server = data?.server;
    if (!server || typeof server.isLoggedIn !== 'boolean') {
      return { status: 'unexpected-response', detail: 'no Soulseek server state' };
    }

    if (server.isConnected === true && server.isLoggedIn) {
      return { status: 'connected' };
    }

    return {
      status: 'not-logged-in',
      serverState: typeof server.state === 'string' && server.state ? server.state : null,
    };
  }

  /**
   * Get every search saved in slskd: waiting, running and finished
   */
  static async getExistingSearches(
    config: SlskdConfig
  ): Promise<SlskdSearchResponse[]> {
    return this.request<SlskdSearchResponse[]>(config, '/api/v0/searches', {
      method: 'GET',
    });
  }

  /**
   * Start a search in slskd. slskd has no wishlist: the search is saved to its Searches
   * page, where you download from the results. See docs/reference/slskd.md, answer 3.
   */
  static async startSearch(
    config: SlskdConfig,
    searchText: string
  ): Promise<SlskdSearchResponse> {
    return this.request<SlskdSearchResponse>(config, '/api/v0/searches', {
      method: 'POST',
      body: JSON.stringify({ searchText }),
    });
  }

  /**
   * Start a search unless one with the same text is already in existingSearches (see
   * isSearchDuplicate). A started search is added to existingSearches, so one push can't
   * start the same search twice. Throws when slskd rejects the search.
   */
  static async startSearchUnlessDuplicate(
    config: SlskdConfig,
    existingSearches: SlskdSearchResponse[],
    searchText: string
  ): Promise<'started' | 'skipped'> {
    if (this.isSearchDuplicate(existingSearches, searchText)) {
      return 'skipped';
    }
    const created = await this.startSearch(config, searchText);
    existingSearches.push({ id: created?.id ?? '', searchText, state: 'Requested' });
    return 'started';
  }

  /**
   * Push tracks to slskd as searches, one at a time. Reads slskd's saved searches once, then
   * skips each track that already has one. A search slskd rejects is counted as failed and
   * the push carries on. Throws only when the saved searches can't be read.
   */
  static async pushTracks(
    config: SlskdConfig,
    tracks: SlskdTrackToSync[],
    onProgress?: (progress: SlskdPushProgress) => void,
    delayMs = PUSH_DELAY_MS
  ): Promise<SlskdSyncResult> {
    const existingSearches = await this.getExistingSearches(config);

    const result: SlskdSyncResult = {
      totalTracks: tracks.length,
      addedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      errors: [],
    };

    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const artist = track.primary_artist || track.artist;
      const label = `${artist} - ${track.title}`;
      const searchText = this.formatSearchQuery(artist, track.title, config.searchFormat);

      onProgress?.({ current: i + 1, total: tracks.length, currentTrack: label });

      try {
        const outcome = await this.startSearchUnlessDuplicate(config, existingSearches, searchText);
        if (outcome === 'skipped') {
          result.skippedCount++;
          continue;
        }
        result.addedCount++;
      } catch (error) {
        result.failedCount++;
        result.errors.push({
          track: label,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      // slskd answers 429 if a search is still starting. Space the requests out.
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    return result;
  }

  /**
   * Format search query for slskd
   *
   * @param artist - Full artist string from Spotify
   * @param title - Track title
   * @param format - 'primary' strips featured artists, 'full' uses complete artist string
   *
   * IMPORTANT:
   * - 'primary' mode uses only first artist - additional artists cause false negatives
   * - Don't include "320 MP3" - causes false negatives on slskd
   */
  static formatSearchQuery(
    artist: string,
    title: string,
    format: 'primary' | 'full' = 'primary'
  ): string {
    let processedArtist = artist;

    if (format === 'primary') {
      // Extract primary artist only - additional artists can cause false negatives
      // Handle comma-separated: "Artist1, Artist2" → "Artist1"
      processedArtist = artist.split(',')[0].trim();
      // Also handle "feat." and "ft.": "Artist feat. Other" → "Artist"
      processedArtist = processedArtist.split(/\s+(?:feat\.?|ft\.?)\s+/i)[0].trim();
    }

    // Remove quotes and sanitize
    const sanitize = (str: string) => str.replace(/["]/g, '').trim();

    // Return clean search query without bitrate/format specifiers
    return `${sanitize(processedArtist)} - ${sanitize(title)}`;
  }

  /**
   * Format search query for slskd album search
   *
   * @param artist - Full artist string from Spotify
   * @param album - Album name
   * @param format - 'primary' strips featured artists, 'full' uses complete artist string
   */
  static formatAlbumSearchQuery(
    artist: string,
    album: string,
    format: 'primary' | 'full' = 'primary'
  ): string {
    let processedArtist = artist;

    if (format === 'primary') {
      processedArtist = artist.split(',')[0].trim();
      processedArtist = processedArtist.split(/\s+(?:feat\.?|ft\.?)\s+/i)[0].trim();
    }

    const sanitize = (str: string) => str.replace(/["]/g, '').trim();

    return `${sanitize(processedArtist)} - ${sanitize(album)}`;
  }

  /**
   * Normalize search text for duplicate detection
   * Removes special characters and normalizes whitespace
   */
  static normalizeSearchText(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Split a search's state into its flags: "Completed, TimedOut" → ['Completed', 'TimedOut']
   */
  static searchStateFlags(state: string | null | undefined): string[] {
    if (typeof state !== 'string') return [];
    return state
      .split(',')
      .map((flag) => flag.trim())
      .filter(Boolean);
  }

  /**
   * Whether a saved search ended in a way worth trying again: slskd cancelled it or it errored.
   */
  static canRetrySearch(search: SlskdSearchResponse): boolean {
    const flags = this.searchStateFlags(search.state);
    return RETRYABLE_SEARCH_FLAGS.some((flag) => flags.includes(flag));
  }

  /**
   * Check if a search already exists and should not be started again.
   * Blocks searches that are waiting or running (Requested, Queued, InProgress), and searches
   * that finished normally (Completed with TimedOut, ResponseLimitReached or
   * FileLimitReached), even with no results. Allows a retry after Cancelled or Errored.
   * A state Mako doesn't recognise counts as blocking, so an unclear search isn't pushed twice.
   */
  static isSearchDuplicate(
    existingSearches: SlskdSearchResponse[],
    newSearchText: string
  ): boolean {
    const normalizedNew = this.normalizeSearchText(newSearchText);
    return existingSearches.some(
      (search) =>
        !this.canRetrySearch(search) &&
        this.normalizeSearchText(search.searchText) === normalizedNew
    );
  }
}
