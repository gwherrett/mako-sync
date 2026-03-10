import { supabase } from '@/integrations/supabase/client';

export interface DuplicateTrack {
  id: string;
  file_path: string;
  title: string | null;
  artist: string | null;
  normalized_title: string | null;
  normalized_artist: string | null;
  bitrate: number | null;
  file_size: number | null;
  audio_format?: string | null; // populated after MAK-19 migration
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
      .select('id, file_path, title, artist, normalized_title, normalized_artist, bitrate, file_size')
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
