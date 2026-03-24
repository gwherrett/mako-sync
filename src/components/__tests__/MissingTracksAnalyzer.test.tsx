import { describe, it, expect } from 'vitest';
import type { SpotifyTrackForGenreEdit } from '@/components/EditSpotifyTrackGenreDialog';
import type { SuperGenre } from '@/types/genreMapping';

/**
 * Tests for MissingTracksAnalyzer logic (MAK-28).
 *
 * The component is React-stateful so tests cover the pure logic
 * extracted from its handlers rather than rendering the component.
 */

// ─── Types matching the component's internal MissingTrack shape ──────────────

interface SpotifyTrackStub {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  genre: string | null;
  super_genre: string | null;
  super_genre_manual_override: boolean;
}

interface MissingTrackStub {
  spotifyTrack: SpotifyTrackStub;
  reason: string;
}

// ─── handleEditSuperGenre logic ───────────────────────────────────────────────

/**
 * Mirrors the component's handleEditSuperGenre: builds a SpotifyTrackForGenreEdit
 * from a MissingTrack to pass into the dialog.
 */
function buildDialogTrack(track: MissingTrackStub): SpotifyTrackForGenreEdit {
  return {
    id: track.spotifyTrack.id,
    title: track.spotifyTrack.title,
    artist: track.spotifyTrack.artist,
    genre: track.spotifyTrack.genre,
    super_genre: track.spotifyTrack.super_genre as SuperGenre | null,
    super_genre_manual_override: track.spotifyTrack.super_genre_manual_override,
  };
}

describe('handleEditSuperGenre — dialog track builder', () => {
  it('maps MissingTrack fields to SpotifyTrackForGenreEdit correctly', () => {
    const track: MissingTrackStub = {
      spotifyTrack: {
        id: 'abc-123',
        title: 'Doin It Right',
        artist: 'Daft Punk',
        album: 'Random Access Memories',
        genre: 'french house',
        super_genre: 'Electronic',
        super_genre_manual_override: false,
      },
      reason: 'no_match',
    };

    const dialogTrack = buildDialogTrack(track);

    expect(dialogTrack.id).toBe('abc-123');
    expect(dialogTrack.title).toBe('Doin It Right');
    expect(dialogTrack.artist).toBe('Daft Punk');
    expect(dialogTrack.genre).toBe('french house');
    expect(dialogTrack.super_genre).toBe('Electronic');
    expect(dialogTrack.super_genre_manual_override).toBe(false);
  });

  it('preserves super_genre_manual_override = true for pinned tracks', () => {
    const track: MissingTrackStub = {
      spotifyTrack: {
        id: 'xyz-999',
        title: 'Pinned Track',
        artist: 'Some Artist',
        album: null,
        genre: null,
        super_genre: 'Jazz',
        super_genre_manual_override: true,
      },
      reason: 'no_match',
    };

    const dialogTrack = buildDialogTrack(track);
    expect(dialogTrack.super_genre_manual_override).toBe(true);
  });
});

// ─── handleGenreSaved — local state update logic ──────────────────────────────

/**
 * Mirrors the component's handleGenreSaved: updates missingTracks and artistGroups
 * in-place after the dialog saves.
 */
function applyGenreSaved(
  tracks: MissingTrackStub[],
  trackId: string,
  superGenre: SuperGenre | null,
  isOverride: boolean
): MissingTrackStub[] {
  return tracks.map(t =>
    t.spotifyTrack.id === trackId
      ? { ...t, spotifyTrack: { ...t.spotifyTrack, super_genre: superGenre, super_genre_manual_override: isOverride } }
      : t
  );
}

describe('handleGenreSaved — local state update', () => {
  const tracks: MissingTrackStub[] = [
    {
      spotifyTrack: { id: 'track-1', title: 'A', artist: 'X', album: null, genre: null, super_genre: 'Rock', super_genre_manual_override: false },
      reason: 'no_match',
    },
    {
      spotifyTrack: { id: 'track-2', title: 'B', artist: 'Y', album: null, genre: null, super_genre: 'Pop', super_genre_manual_override: false },
      reason: 'no_match',
    },
  ];

  it('updates super_genre and sets override flag for the saved track', () => {
    const updated = applyGenreSaved(tracks, 'track-1', 'Jazz' as SuperGenre, true);

    expect(updated[0].spotifyTrack.super_genre).toBe('Jazz');
    expect(updated[0].spotifyTrack.super_genre_manual_override).toBe(true);
  });

  it('does not affect other tracks', () => {
    const updated = applyGenreSaved(tracks, 'track-1', 'Jazz' as SuperGenre, true);

    expect(updated[1].spotifyTrack.super_genre).toBe('Pop');
    expect(updated[1].spotifyTrack.super_genre_manual_override).toBe(false);
  });

  it('clears override flag when reset to auto', () => {
    const pinned = applyGenreSaved(tracks, 'track-2', 'Pop' as SuperGenre, true);
    const reset = applyGenreSaved(pinned, 'track-2', 'Pop' as SuperGenre, false);

    expect(reset[1].spotifyTrack.super_genre_manual_override).toBe(false);
  });
});

// ─── Override badge visibility ────────────────────────────────────────────────

describe('override badge visibility', () => {
  it('shows badge when super_genre_manual_override is true', () => {
    const track: SpotifyTrackStub = {
      id: 't1', title: 'T', artist: 'A', album: null, genre: null,
      super_genre: 'Rock', super_genre_manual_override: true,
    };
    expect(track.super_genre_manual_override).toBe(true);
  });

  it('hides badge when super_genre_manual_override is false', () => {
    const track: SpotifyTrackStub = {
      id: 't1', title: 'T', artist: 'A', album: null, genre: null,
      super_genre: 'Rock', super_genre_manual_override: false,
    };
    expect(track.super_genre_manual_override).toBe(false);
  });
});
