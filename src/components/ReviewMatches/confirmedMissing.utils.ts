import type { SpotifyTrackForGenreEdit } from '@/components/EditSpotifyTrackGenreDialog';
import type { ConfirmedMissingTrack } from '@/services/manualMatch.service';
import type { SuperGenre } from '@/types/genreMapping';
import type { SlskdTrackToSync } from '@/types/slskd';

/**
 * Helpers for the Confirmed Missing section. Moved from MissingTracksAnalyzer (MAK-181), and
 * kept the same so the CSV and the slskd payload match what the old Missing Tracks tab made.
 */

export interface ArtistGroup {
  artist: string;
  /** Sorted by album, then title. */
  tracks: ConfirmedMissingTrack[];
  /** The tracks' Spotify genres and supergenres, without repeats. */
  genres: string[];
}

export interface AlbumGroup {
  album: string | null;
  tracks: ConfirmedMissingTrack[];
}

export const CSV_COLUMNS = ['Artist', 'Track Count', 'Track Title', 'Album', 'Spotify Genre', 'Supergenre'] as const;

/** Group tracks by artist, most tracks first. Each artist's tracks are sorted by album, then title. */
export function groupByArtist(tracks: ConfirmedMissingTrack[]): ArtistGroup[] {
  const groups = new Map<string, { tracks: ConfirmedMissingTrack[]; genres: Set<string> }>();
  for (const track of tracks) {
    const { artist, genre, super_genre } = track.spotifyTrack;
    let group = groups.get(artist);
    if (!group) {
      group = { tracks: [], genres: new Set() };
      groups.set(artist, group);
    }
    group.tracks.push(track);
    if (genre) group.genres.add(genre);
    if (super_genre) group.genres.add(super_genre);
  }

  return [...groups]
    .map(([artist, group]) => ({
      artist,
      genres: [...group.genres],
      tracks: group.tracks.slice().sort((a, b) => {
        const albumA = a.spotifyTrack.album || '';
        const albumB = b.spotifyTrack.album || '';
        if (albumA !== albumB) return albumA.localeCompare(albumB);
        return a.spotifyTrack.title.localeCompare(b.spotifyTrack.title);
      }),
    }))
    .sort((a, b) => b.tracks.length - a.tracks.length || a.artist.localeCompare(b.artist));
}

/** Split an artist's sorted tracks into runs of the same album, for rendering. */
export function groupTracksByAlbum(tracks: ConfirmedMissingTrack[]): AlbumGroup[] {
  const result: AlbumGroup[] = [];
  for (const track of tracks) {
    const album = track.spotifyTrack.album ?? null;
    const last = result[result.length - 1];
    if (last && last.album === album) last.tracks.push(track);
    else result.push({ album, tracks: [track] });
  }
  return result;
}

/** The groups for the selected artists, in display order. */
export function selectedGroups(groups: ArtistGroup[], selectedArtists: ReadonlySet<string>): ArtistGroup[] {
  return groups.filter(group => selectedArtists.has(group.artist));
}

/** Quote a CSV field. A quote inside the value is doubled, so it can't end the field early. */
function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * The CSV the old Missing Tracks tab exported: one row per track, grouped by artist. The
 * artist's first row carries the artist and track count; the rest leave those cells empty.
 */
export function buildMissingTracksCsv(groups: ArtistGroup[]): string {
  const rows: string[] = [CSV_COLUMNS.join(',')];
  for (const group of groups) {
    group.tracks.forEach((track, index) => {
      const { title, album, genre, super_genre } = track.spotifyTrack;
      rows.push(
        [
          index === 0 ? csvField(group.artist) : '""',
          index === 0 ? group.tracks.length.toString() : '""',
          csvField(title),
          csvField(album || ''),
          csvField(genre || ''),
          csvField(super_genre || ''),
        ].join(',')
      );
    });
  }
  return rows.join('\n');
}

/** Same file name as the old export: the UTC date it was made. */
export function missingTracksCsvFileName(date: Date = new Date()): string {
  return `missing-tracks-by-artist-${date.toISOString().split('T')[0]}.csv`;
}

/**
 * The slskd payload for every track in `groups`. The full artist goes in `primary_artist` too,
 * as it did on the old tab, so the slskd searches stay the same.
 */
export function slskdTracksForGroups(groups: ArtistGroup[]): SlskdTrackToSync[] {
  return groups.flatMap(group =>
    group.tracks.map(({ spotifyTrack }) => ({
      id: spotifyTrack.id,
      title: spotifyTrack.title,
      artist: spotifyTrack.artist,
      primary_artist: spotifyTrack.artist,
    }))
  );
}

/** The slskd payload for an album push. The album's first track stands for the album. */
export function slskdAlbumTrack(albumTracks: ConfirmedMissingTrack[], album: string): SlskdTrackToSync {
  const { id, title, artist } = albumTracks[0].spotifyTrack;
  return { id, title, artist, primary_artist: artist, album };
}

/** The track the Edit SuperGenre dialog edits. */
export function genreEditTrack({ spotifyTrack }: ConfirmedMissingTrack): SpotifyTrackForGenreEdit {
  return {
    id: spotifyTrack.id,
    title: spotifyTrack.title,
    artist: spotifyTrack.artist,
    genre: spotifyTrack.genre,
    super_genre: spotifyTrack.super_genre as SuperGenre | null,
    super_genre_manual_override: spotifyTrack.super_genre_manual_override,
  };
}
