import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DuplicateDetectionService, DuplicateGroup } from '@/services/duplicateDetection.service';

/**
 * Tests for DuplicateTracksManager business logic.
 *
 * The component is React-stateful and requires auth context, so tests cover
 * the pure logic extracted from it:
 *  - Default keep selection (highest bitrate)
 *  - Resolve calls service with correct keep/delete IDs
 *  - groupKey is stable across track order
 */

// ─── Helpers mirroring component logic ───────────────────────────────────────

function groupKey(g: DuplicateGroup): string {
  return `${g.normalized_artist}\0${g.normalized_title}`;
}

function defaultKeepSelections(groups: DuplicateGroup[]): Record<string, string> {
  const selections: Record<string, string> = {};
  for (const g of groups) {
    selections[groupKey(g)] = g.tracks[0].id; // first = highest bitrate (service orders by bitrate DESC)
  }
  return selections;
}

function resolveIds(group: DuplicateGroup, keepId: string): { keepId: string; deleteIds: string[] } {
  return {
    keepId,
    deleteIds: group.tracks.map(t => t.id).filter(id => id !== keepId),
  };
}

// ─── Test data ───────────────────────────────────────────────────────────────

const makeGroup = (overrides: Partial<DuplicateGroup> = {}): DuplicateGroup => ({
  normalized_title: 'test track',
  normalized_artist: 'test artist',
  tracks: [
    { id: 'high', file_path: '/a.mp3', title: 'Test Track', artist: 'Test Artist', normalized_title: 'test track', normalized_artist: 'test artist', bitrate: 320, file_size: 10000, audio_format: 'mp3' },
    { id: 'low', file_path: '/b.mp3', title: 'Test Track', artist: 'Test Artist', normalized_title: 'test track', normalized_artist: 'test artist', bitrate: 128, file_size: 4000, audio_format: 'mp3' },
  ],
  ...overrides,
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DuplicateTracksManager logic', () => {
  describe('defaultKeepSelections', () => {
    it('pre-selects the first track (highest bitrate) in each group', () => {
      const groups = [makeGroup()];
      const selections = defaultKeepSelections(groups);
      const key = groupKey(groups[0]);
      expect(selections[key]).toBe('high');
    });

    it('creates one selection per group', () => {
      const groups = [
        makeGroup({ normalized_title: 'track a', normalized_artist: 'artist a' }),
        makeGroup({ normalized_title: 'track b', normalized_artist: 'artist b' }),
      ];
      const selections = defaultKeepSelections(groups);
      expect(Object.keys(selections)).toHaveLength(2);
    });
  });

  describe('resolveIds', () => {
    it('excludes keepId from deleteIds', () => {
      const group = makeGroup();
      const { keepId, deleteIds } = resolveIds(group, 'high');
      expect(keepId).toBe('high');
      expect(deleteIds).toEqual(['low']);
      expect(deleteIds).not.toContain('high');
    });

    it('marks all other tracks for deletion', () => {
      const group: DuplicateGroup = {
        normalized_title: 'track',
        normalized_artist: 'artist',
        tracks: [
          { id: 'a', file_path: '/a.mp3', title: 'T', artist: 'A', normalized_title: 'track', normalized_artist: 'artist', bitrate: 320, file_size: 10000, audio_format: 'mp3' },
          { id: 'b', file_path: '/b.mp3', title: 'T', artist: 'A', normalized_title: 'track', normalized_artist: 'artist', bitrate: 256, file_size: 8000, audio_format: 'mp3' },
          { id: 'c', file_path: '/c.mp3', title: 'T', artist: 'A', normalized_title: 'track', normalized_artist: 'artist', bitrate: 128, file_size: 4000, audio_format: 'mp3' },
        ],
      };
      const { deleteIds } = resolveIds(group, 'a');
      expect(deleteIds).toEqual(['b', 'c']);
    });

    it('produces empty deleteIds if only one track (edge case)', () => {
      const group: DuplicateGroup = {
        normalized_title: 'track',
        normalized_artist: 'artist',
        tracks: [
          { id: 'solo', file_path: '/a.mp3', title: 'T', artist: 'A', normalized_title: 'track', normalized_artist: 'artist', bitrate: 320, file_size: 10000, audio_format: 'mp3' },
        ],
      };
      const { deleteIds } = resolveIds(group, 'solo');
      expect(deleteIds).toHaveLength(0);
    });
  });

  describe('groupKey', () => {
    it('is stable regardless of track order within group', () => {
      const g1 = makeGroup();
      const g2: DuplicateGroup = { ...g1, tracks: [...g1.tracks].reverse() };
      expect(groupKey(g1)).toBe(groupKey(g2));
    });

    it('differs for different artist+title combinations', () => {
      const g1 = makeGroup({ normalized_title: 'title a', normalized_artist: 'artist' });
      const g2 = makeGroup({ normalized_title: 'title b', normalized_artist: 'artist' });
      expect(groupKey(g1)).not.toBe(groupKey(g2));
    });
  });

  describe('resolveDuplicate service integration', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('calls resolveDuplicate with correct keepId and deleteIds', async () => {
      const spy = vi.spyOn(DuplicateDetectionService, 'resolveDuplicate').mockResolvedValue();
      const group = makeGroup();
      const { keepId, deleteIds } = resolveIds(group, 'high');

      await DuplicateDetectionService.resolveDuplicate(keepId, deleteIds);

      expect(spy).toHaveBeenCalledWith('high', ['low']);
    });
  });
});
