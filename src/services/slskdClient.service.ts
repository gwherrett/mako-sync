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
  SlskdSearchResponse,
} from '@/types/slskd';

const CONNECTION_TEST_TIMEOUT_MS = 10000;

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
   * Get existing searches from slskd wishlist
   */
  static async getExistingSearches(
    config: SlskdConfig
  ): Promise<SlskdSearchResponse[]> {
    return this.request<SlskdSearchResponse[]>(config, '/api/v0/searches', {
      method: 'GET',
    });
  }

  /**
   * Add track to slskd wishlist (creates a search)
   */
  static async addToWishlist(
    config: SlskdConfig,
    searchText: string
  ): Promise<SlskdSearchResponse> {
    return this.request<SlskdSearchResponse>(config, '/api/v0/searches', {
      method: 'POST',
      body: JSON.stringify({ searchText }),
    });
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
   * Check if a search already exists and should not be re-added.
   * Blocks InProgress (currently running) and Completed (already found results).
   * Allows retry for TimedOut, Cancelled, and Errored searches.
   */
  static isSearchDuplicate(
    existingSearches: SlskdSearchResponse[],
    newSearchText: string
  ): boolean {
    const normalizedNew = this.normalizeSearchText(newSearchText);
    return existingSearches.some(
      (search) =>
        (search.state === 'InProgress' || search.state === 'Completed') &&
        this.normalizeSearchText(search.searchText) === normalizedNew
    );
  }
}
