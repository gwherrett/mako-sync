/**
 * slskd Client Service
 *
 * Handles all communication with the slskd REST API.
 * slskd is a Soulseek client with a web interface and API.
 */

import type {
  SlskdConfig,
  SlskdSearchResponse,
  SlskdSessionResponse,
} from '@/types/slskd';

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
   * Test connection to slskd instance
   * Returns true if connected and logged in to Soulseek network
   */
  static async testConnection(config: SlskdConfig): Promise<boolean> {
    try {
      // Try /api/v0/application first - it's a simple endpoint that should work with API key
      const url = `${config.apiEndpoint}/api/v0/application`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-API-Key': config.apiKey,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        console.error('slskd connection test failed:', response.status, response.statusText);
        return false;
      }

      // Check content type to ensure we got JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error('slskd returned non-JSON response:', contentType);
        return false;
      }

      const data = await response.json();
      // If we got a valid response, connection is working
      return Boolean(data);
    } catch (error) {
      console.error('slskd connection test failed:', error);
      return false;
    }
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
   * Check if an active (InProgress) search already exists
   * Only skips if a search is currently running — completed/timed-out/cancelled
   * searches are not considered duplicates since slskd has no real wishlist persistence
   */
  static isSearchDuplicate(
    existingSearches: SlskdSearchResponse[],
    newSearchText: string
  ): boolean {
    const normalizedNew = this.normalizeSearchText(newSearchText);
    return existingSearches.some(
      (search) =>
        search.state === 'InProgress' &&
        this.normalizeSearchText(search.searchText) === normalizedNew
    );
  }
}
