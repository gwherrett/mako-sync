import { supabase } from '@/integrations/supabase/client';
import { withTimeout } from '@/utils/promiseUtils';

export interface DuplicateTrack {
  id: string;
  file_path: string;
  title: string | null;
  artist: string | null;
  normalized_title: string | null;
  normalized_artist: string | null;
  bitrate: number | null;
  file_size: number | null;
  audio_format: string | null;
}

export interface SpotifyDuplicateTrack {
  id: string;
  spotify_id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  normalized_title: string | null;
  normalized_artist: string | null;
  added_at: string | null;
}

export interface SpotifyDuplicateGroup {
  normalized_title: string;
  normalized_artist: string;
  /** Tracks ordered by added_at DESC (most recently liked first) */
  tracks: SpotifyDuplicateTrack[];
}

export interface SpotifyResolveResult {
  removed: number;
  errors: string[];
}

export interface DuplicateGroup {
  normalized_title: string;
  normalized_artist: string;
  /** Tracks ordered by bitrate DESC (highest quality first) */
  tracks: DuplicateTrack[];
}

export class DuplicateDetectionService {
  /**
   * Find all local tracks that share the same normalized_title + normalized_artist.
   * Returns groups ordered by artist then title, each group ordered by bitrate DESC.
   */
  static async findDuplicates(userId: string): Promise<DuplicateGroup[]> {
    const { data, error } = await supabase
      .from('local_mp3s')
      .select('id, file_path, title, artist, normalized_title, normalized_artist, bitrate, file_size, audio_format')
      .eq('user_id', userId)
      .not('normalized_title', 'is', null)
      .not('normalized_artist', 'is', null)
      .order('normalized_artist', { ascending: true })
      .order('normalized_title', { ascending: true })
      .order('bitrate', { ascending: false, nullsFirst: false });

    if (error) {
      console.error('Error fetching tracks for duplicate detection:', error);
      throw error;
    }

    const rows = (data || []) as DuplicateTrack[];

    // Group by normalized_title + normalized_artist
    const groupMap = new Map<string, DuplicateTrack[]>();
    for (const row of rows) {
      const key = `${row.normalized_artist}\0${row.normalized_title}`;
      const group = groupMap.get(key);
      if (group) {
        group.push(row);
      } else {
        groupMap.set(key, [row]);
      }
    }

    // Keep only groups with more than one track
    const duplicates: DuplicateGroup[] = [];
    for (const [, tracks] of groupMap) {
      if (tracks.length > 1) {
        duplicates.push({
          normalized_title: tracks[0].normalized_title!,
          normalized_artist: tracks[0].normalized_artist!,
          tracks,
        });
      }
    }

    return duplicates;
  }

  /**
   * Find all Spotify liked songs that share the same normalized_title + normalized_artist.
   * Returns groups ordered by artist then title, each group ordered by added_at DESC.
   */
  static async findSpotifyDuplicates(userId: string): Promise<SpotifyDuplicateGroup[]> {
    const { data, error } = await withTimeout(
      supabase
        .from('spotify_liked')
        .select('id, spotify_id, title, artist, album, normalized_title, normalized_artist, added_at')
        .eq('user_id', userId)
        .not('normalized_title', 'is', null)
        .not('normalized_artist', 'is', null)
        .order('normalized_artist', { ascending: true })
        .order('normalized_title', { ascending: true })
        .order('added_at', { ascending: false, nullsFirst: false })
        .then(r => r),
      45000,
      'Spotify duplicate query timed out'
    );

    if (error) {
      console.error('Error fetching Spotify tracks for duplicate detection:', error);
      throw error;
    }

    const rows = (data || []) as SpotifyDuplicateTrack[];

    const groupMap = new Map<string, SpotifyDuplicateTrack[]>();
    for (const row of rows) {
      const key = `${row.normalized_artist}\0${row.normalized_title}`;
      const group = groupMap.get(key);
      if (group) {
        group.push(row);
      } else {
        groupMap.set(key, [row]);
      }
    }

    const duplicates: SpotifyDuplicateGroup[] = [];
    for (const [, tracks] of groupMap) {
      if (tracks.length > 1) {
        duplicates.push({
          normalized_title: tracks[0].normalized_title!,
          normalized_artist: tracks[0].normalized_artist!,
          tracks,
        });
      }
    }

    return duplicates;
  }

  /**
   * Unlike the specified Spotify tracks and remove them from the DB.
   * The actual Spotify API call is proxied through the spotify-unlike-tracks Edge Function
   * since the access token is stored in Supabase Vault (never available client-side).
   * Throws if keepId is included in deleteIds (safety check).
   */
  static async resolveSpotifyDuplicate(
    keepId: string,
    deleteIds: string[],
    userId: string
  ): Promise<SpotifyResolveResult> {
    if (deleteIds.includes(keepId)) {
      throw new Error('keepId must not appear in deleteIds');
    }
    if (deleteIds.length === 0) return { removed: 0, errors: [] };

    // Fetch the spotify_id values for the rows we want to delete
    const { data: rows, error: fetchError } = await supabase
      .from('spotify_liked')
      .select('id, spotify_id')
      .in('id', deleteIds)
      .eq('user_id', userId);

    if (fetchError) throw fetchError;

    const spotifyIds = (rows || []).map(r => r.spotify_id as string).filter(Boolean);

    // Proxy the DELETE call through the Edge Function (vault token read happens server-side)
    const { data: result, error: fnError } = await withTimeout(
      supabase.functions.invoke('spotify-unlike-tracks', { body: { spotifyIds } }).then(r => r),
      30000,
      'spotify-unlike-tracks timed out'
    );

    if (fnError) throw fnError;

    const { removed, errors } = result as SpotifyResolveResult;

    // Remove the successfully unliked rows from the DB
    if (removed > 0) {
      const { error: deleteError } = await supabase
        .from('spotify_liked')
        .delete()
        .in('id', deleteIds)
        .eq('user_id', userId);

      if (deleteError) {
        return { removed, errors: [...errors, `DB delete error: ${deleteError.message}`] };
      }
    }

    return { removed, errors };
  }

  /**
   * Unlike a single Spotify track and remove it from spotify_liked.
   * Proxied through the spotify-unlike-tracks Edge Function (vault token read happens server-side).
   */
  static async unlikeTrack(spotifyId: string, userId: string): Promise<void> {
    const { data: result, error: fnError } = await withTimeout(
      supabase.functions.invoke('spotify-unlike-tracks', { body: { spotifyIds: [spotifyId] } }).then(r => r),
      30000,
      'spotify-unlike-tracks timed out'
    );

    if (fnError) throw fnError;

    const { removed, errors } = result as SpotifyResolveResult;

    if (errors?.length > 0) throw new Error(errors[0]);

    if (removed > 0) {
      const { error: deleteError } = await supabase
        .from('spotify_liked')
        .delete()
        .eq('spotify_id', spotifyId)
        .eq('user_id', userId);

      if (deleteError) throw deleteError;
    }
  }

  /**
   * Delete the specified tracks, keeping the nominated one.
   * Throws if keepId is included in deleteIds (safety check).
   */
  static async resolveDuplicate(keepId: string, deleteIds: string[]): Promise<void> {
    if (deleteIds.includes(keepId)) {
      throw new Error('keepId must not appear in deleteIds');
    }
    if (deleteIds.length === 0) return;

    const { error } = await supabase
      .from('local_mp3s')
      .delete()
      .in('id', deleteIds);

    if (error) {
      console.error('Error resolving duplicates:', error);
      throw error;
    }
  }
}
