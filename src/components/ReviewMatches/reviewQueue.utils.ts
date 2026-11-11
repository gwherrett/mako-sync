import { TIER_MATCH_METHOD, type MatchMethod, type ReviewItem } from '@/services/manualMatch.service';
import type { LocalTrack } from '@/services/trackMatchingEngine';

/** What a person can do on a review queue row. */
export type RowAction = 'confirm' | 'reject' | 'pick' | 'confirmMissing';

export interface TierBadge {
  label: string;
  /** Tailwind classes that give each tier its own look. Applied to the badge, not just computed. */
  className: string;
}

/** The most local files the picker lists at once. Typing narrows the list. */
export const PICKER_RESULT_LIMIT = 50;

/** Badge text and colour for a queue row: Core Title is neutral, Fuzzy is amber, No Match is muted. */
export function getTierBadge(item: Pick<ReviewItem, 'tier' | 'similarity'>): TierBadge {
  if (item.tier === 2) {
    // Not the `secondary` token: it is the theme's red, which would read as a warning.
    return { label: 'Core Title', className: 'border-transparent bg-muted text-foreground' };
  }
  if (item.tier === 3) {
    const percent = item.similarity !== undefined ? ` ${Math.round(item.similarity)}%` : '';
    return { label: `Fuzzy${percent}`, className: 'border-amber-500/50 bg-amber-500/10 text-amber-600' };
  }
  return { label: 'No Match', className: 'border-dashed bg-transparent text-muted-foreground' };
}

/**
 * The actions a row offers. A row with a candidate can confirm it, or reject it and pick
 * another file. A row with no candidate goes straight to the picker.
 */
export function getRowActions(item: Pick<ReviewItem, 'tier' | 'candidate'>): RowAction[] {
  return item.tier && item.candidate
    ? ['confirm', 'reject', 'confirmMissing']
    : ['pick', 'confirmMissing'];
}

/** The `match_method` to record for a row's engine suggestion. */
export function candidateMatchMethod(item: Pick<ReviewItem, 'tier'>): MatchMethod {
  return item.tier ? TIER_MATCH_METHOD[item.tier] : 'manual';
}

function searchText(track: LocalTrack): string {
  return `${track.title ?? ''} ${track.artist ?? ''}`.toLowerCase();
}

/**
 * Local files for the picker, searched by title and artist. Every word typed must appear.
 * Files by `preferredArtist` come first, so with nothing typed the list opens on the most
 * likely picks. `excludeIds` drops files already rejected for this track.
 */
export function searchLocalTracks(
  localTracks: LocalTrack[],
  query: string,
  {
    excludeIds = [],
    preferredArtist = null,
    limit = PICKER_RESULT_LIMIT,
  }: { excludeIds?: Iterable<string>; preferredArtist?: string | null; limit?: number } = {}
): LocalTrack[] {
  const excluded = new Set(excludeIds);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const preferred = preferredArtist?.trim().toLowerCase() || null;

  const sameArtist: LocalTrack[] = [];
  const others: LocalTrack[] = [];
  for (const track of localTracks) {
    if (excluded.has(track.id)) continue;
    const text = searchText(track);
    if (!words.every(word => text.includes(word))) continue;

    const artist = (track.primary_artist || track.artist || '').toLowerCase();
    if (preferred && artist.includes(preferred)) sameArtist.push(track);
    else others.push(track);
  }

  return [...sameArtist, ...others].slice(0, limit);
}
