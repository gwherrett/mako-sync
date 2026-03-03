import { describe, it, expect } from 'vitest';
import { SlskdClientService } from '../slskdClient.service';

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
