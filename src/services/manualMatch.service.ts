import { supabase } from '@/integrations/supabase/client';
import type { Tables, TablesInsert } from '@/integrations/supabase/types';
import { withTimeout } from '@/utils/promiseUtils';
import {
  TrackMatchingService,
  fetchAllPages,
  type MatchCandidateFilters,
} from './trackMatching.service';
import type { LocalTrack, MatchResult, SpotifyTrack } from './trackMatchingEngine';

/**
 * Reads and writes manual match review decisions in `track_matches`
 * (docs/plans/manual-match-review.md, Part 1, Phase 3).
 *
 * Row semantics (is_confirmed is tri-state):
 *   true  = confirmed match, or confirmed missing when mp3_id IS NULL
 *   false = rejected candidate
 *   null  = engine suggestion, not yet reviewed
 *
 * Every `spotifyLikedId` is `spotify_liked.id` (the uuid `track_matches.spotify_track_id`
 * points at), never Spotify's own `spotify_id`.
 */

/** Rows per upsert. Bigger batches time out on large libraries (CLAUDE.md, Batch Processing). */
export const DB_BATCH_SIZE = 100;
const WRITE_TIMEOUT_MS = 30000;

/** The `track_matches.match_method` values the review flow writes. */
export type MatchMethod = 'tier1_exact' | 'tier2_core' | 'tier3_fuzzy' | 'manual';

/** Who created a `track_matches` row. */
export type MatchSource = 'engine' | 'human';

/** The match_method for a result from each engine tier. */
export const TIER_MATCH_METHOD: Record<1 | 2 | 3, MatchMethod> = {
  1: 'tier1_exact',
  2: 'tier2_core',
  3: 'tier3_fuzzy',
};

export type TrackMatchDecision = Tables<'track_matches'>;
type TrackMatchInsert = TablesInsert<'track_matches'>;

/** A Tier 1 result. The engine is trusted at this tier, so it isn't queued for review. */
export interface AutoConfirmedMatch {
  spotifyTrack: SpotifyTrack;
  localTrack: LocalTrack;
  /** The confirmed row, or null until `bulkAutoConfirmTier1` writes it. */
  trackMatchId: string | null;
}

/** A Spotify track that still needs a decision. */
export interface ReviewItem {
  spotifyTrack: SpotifyTrack;
  /** The engine's suggestion. Null when the engine found none or the person rejected it. */
  candidate: LocalTrack | null;
  /** The tier that suggested `candidate`, or null when there is no candidate. */
  tier: 2 | 3 | null;
  /** Title similarity in percent, for Tier 3 candidates. */
  similarity?: number;
  /** Local files already rejected for this track, so a picker can leave them out. */
  rejectedMp3Ids: string[];
}

/** A Spotify track the person confirmed has no local copy. */
export interface ConfirmedMissingTrack {
  trackMatchId: string;
  spotifyTrack: SpotifyTrack;
  failureCategory: string | null;
  notes: string | null;
  reviewedAt: string | null;
}

export interface ReviewCandidates {
  autoConfirmed: AutoConfirmedMatch[];
  toReview: ReviewItem[];
  confirmedMissing: ConfirmedMissingTrack[];
  /**
   * Every local track the user has, for search-and-pick. Not scoped to the filters like the
   * engine's candidates: a manual pick is most needed when the file's artist tag differs
   * from Spotify's, and that file is outside the artist-overlap scope.
   */
  localTracks: LocalTrack[];
}

export interface ConfirmMatchOptions {
  method: MatchMethod;
  /** Tier 3 similarity in percent. Leave out for other tiers and manual picks. */
  confidence?: number | null;
  source: MatchSource;
}

export interface RejectCandidateOptions {
  /** The tier that suggested the rejected file, so the row records which tier got it wrong. */
  method: MatchMethod;
  /** Why the engine got it wrong. Same vocabulary as `FailureCategory` in the eval fixtures. */
  failureCategory?: string | null;
  notes?: string | null;
}

export interface ConfirmMissingOptions {
  failureCategory?: string | null;
  notes?: string | null;
}

/** Engine results for the filters, plus every decision already saved for those tracks. */
interface ReviewState {
  results: MatchResult[];
  localTracks: LocalTrack[];
  decisionsByTrack: Map<string, TrackMatchDecision[]>;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Run a write with withTimeout. Pass the query already converted with `.then(r => r)`; its type
 * is PromiseLike, so it is wrapped in a real Promise here.
 */
function timedWrite<T>(query: PromiseLike<T>, label: string): Promise<T> {
  return withTimeout(Promise.resolve(query), WRITE_TIMEOUT_MS, `${label} timed out`);
}

/** Group a user's decisions by Spotify track, keeping only the tracks in `spotifyLikedIds`. */
async function fetchDecisions(
  userId: string,
  spotifyLikedIds: Set<string>
): Promise<Map<string, TrackMatchDecision[]>> {
  const decisionsByTrack = new Map<string, TrackMatchDecision[]>();
  if (spotifyLikedIds.size === 0) return decisionsByTrack;

  // One paginated read of the user's decisions. Filtering by id list instead would need one
  // request per few hundred ids to keep the URL short, which is slower for a full library.
  const rows = await fetchAllPages<TrackMatchDecision>(
    (from, to) =>
      supabase
        .from('track_matches')
        .select(
          'id, spotify_track_id, mp3_id, is_confirmed, match_method, match_confidence, matched_at, source, reviewed_at, failure_category, notes, spotify_liked!inner(user_id)'
        )
        .eq('spotify_liked.user_id', userId)
        .order('id')
        .range(from, to)
        .then(r => r),
    'fetch track matches'
  );

  for (const row of rows) {
    if (!spotifyLikedIds.has(row.spotify_track_id)) continue;
    const decisions = decisionsByTrack.get(row.spotify_track_id);
    if (decisions) decisions.push(row);
    else decisionsByTrack.set(row.spotify_track_id, [row]);
  }
  return decisionsByTrack;
}

async function loadReviewState(userId: string, filters: MatchCandidateFilters): Promise<ReviewState> {
  const { results, allLocalTracks: localTracks } = await TrackMatchingService.getMatchCandidates(userId, filters);
  const decisionsByTrack = await fetchDecisions(
    userId,
    new Set(results.map(result => result.spotifyTrack.id))
  );
  return { results, localTracks, decisionsByTrack };
}

function confirmedDecision(decisions: TrackMatchDecision[]): TrackMatchDecision | undefined {
  return decisions.find(decision => decision.is_confirmed === true);
}

function rejectedMp3Ids(decisions: TrackMatchDecision[]): Set<string> {
  const ids = new Set<string>();
  for (const decision of decisions) {
    if (decision.is_confirmed === false && decision.mp3_id) ids.add(decision.mp3_id);
  }
  return ids;
}

/** The engine's candidate, unless the person already rejected it. */
function liveCandidate(result: MatchResult, rejected: Set<string>): LocalTrack | null {
  const candidate = result.matchedLocalTrack;
  if (!result.matched || !candidate || rejected.has(candidate.id)) return null;
  return candidate;
}

/**
 * Sort engine results into review groups. A saved decision always wins over the engine:
 * a track with a confirmed row is never queued, and a rejected pair is never suggested again.
 */
function groupForReview({ results, localTracks, decisionsByTrack }: ReviewState): ReviewCandidates {
  const groups: ReviewCandidates = { autoConfirmed: [], toReview: [], confirmedMissing: [], localTracks };

  for (const result of results) {
    const { spotifyTrack } = result;
    const decisions = decisionsByTrack.get(spotifyTrack.id) ?? [];
    const confirmed = confirmedDecision(decisions);

    if (confirmed) {
      if (confirmed.mp3_id === null) {
        groups.confirmedMissing.push({
          trackMatchId: confirmed.id,
          spotifyTrack,
          failureCategory: confirmed.failure_category,
          notes: confirmed.notes,
          reviewedAt: confirmed.reviewed_at,
        });
      } else if (result.tier === 1 && result.matchedLocalTrack?.id === confirmed.mp3_id) {
        groups.autoConfirmed.push({
          spotifyTrack,
          localTrack: result.matchedLocalTrack,
          trackMatchId: confirmed.id,
        });
      }
      // Any other confirmed row is a person's pick that overrides the engine: already decided.
      continue;
    }

    const rejected = rejectedMp3Ids(decisions);
    const candidate = liveCandidate(result, rejected);

    if (candidate && result.tier === 1) {
      groups.autoConfirmed.push({ spotifyTrack, localTrack: candidate, trackMatchId: null });
      continue;
    }

    const tier = candidate && (result.tier === 2 || result.tier === 3) ? result.tier : null;
    groups.toReview.push({
      spotifyTrack,
      candidate: tier ? candidate : null,
      tier,
      ...(tier === 3 && result.similarity !== undefined ? { similarity: result.similarity } : {}),
      rejectedMp3Ids: [...rejected],
    });
  }

  return groups;
}

async function upsertDecision(row: TrackMatchInsert, label: string): Promise<string> {
  const { data, error } = await timedWrite(
    supabase
      .from('track_matches')
      .upsert(row, { onConflict: 'spotify_track_id,mp3_id' })
      .select('id')
      .single()
      .then(r => r),
    label
  );
  if (error) throw new Error(`Failed to ${label}: ${error.message}`);
  return data.id;
}

/**
 * Mark every unreviewed suggestion for a track as rejected, so "shown but not chosen" is
 * recorded without a reject click. `match_method` is left alone: it records which tier made
 * the suggestion.
 */
async function rejectUnreviewedSuggestions(spotifyLikedId: string, reviewedAt: string): Promise<void> {
  const { error } = await timedWrite(
    supabase
      .from('track_matches')
      .update({ is_confirmed: false, reviewed_at: reviewedAt })
      .eq('spotify_track_id', spotifyLikedId)
      .is('is_confirmed', null)
      .then(r => r),
    'reject unreviewed suggestions'
  );
  if (error) {
    throw new Error(`Saved the decision, but failed to reject the other suggestions: ${error.message}`);
  }
}

export class ManualMatchService {
  /**
   * Engine results for the filters, sorted into review groups using the decisions already saved:
   * - `autoConfirmed`: Tier 1 results.
   * - `toReview`: Tier 2, Tier 3 and no-match results with no confirmed row. A rejected
   *   candidate is dropped, which leaves the track in the queue with no candidate.
   * - `confirmedMissing`: tracks confirmed as having no local copy.
   * A track whose confirmed row is a person's pick of another file is in none of the groups.
   */
  static async getCandidatesForReview(
    userId: string,
    filters: MatchCandidateFilters = {}
  ): Promise<ReviewCandidates> {
    const groups = groupForReview(await loadReviewState(userId, filters));
    console.log(
      `🧾 Review queue: ${groups.toReview.length} to review, ${groups.autoConfirmed.length} exact, ` +
      `${groups.confirmedMissing.length} confirmed missing`
    );
    return groups;
  }

  /**
   * Save every Tier 1 result as a confirmed engine match, in batches of DB_BATCH_SIZE.
   * Skips tracks that already have a confirmed row, and pairs the person rejected.
   * Returns the number of rows written.
   */
  static async bulkAutoConfirmTier1(userId: string, filters: MatchCandidateFilters = {}): Promise<number> {
    const { results, decisionsByTrack } = await loadReviewState(userId, filters);

    const rows: TrackMatchInsert[] = [];
    for (const result of results) {
      if (result.tier !== 1) continue;
      const decisions = decisionsByTrack.get(result.spotifyTrack.id) ?? [];
      if (confirmedDecision(decisions)) continue;
      const candidate = liveCandidate(result, rejectedMp3Ids(decisions));
      if (!candidate) continue;

      rows.push({
        spotify_track_id: result.spotifyTrack.id,
        mp3_id: candidate.id,
        is_confirmed: true,
        match_method: TIER_MATCH_METHOD[1],
        match_confidence: null,
        source: 'engine',
      });
    }

    for (let i = 0; i < rows.length; i += DB_BATCH_SIZE) {
      const batch = rows.slice(i, i + DB_BATCH_SIZE);
      const { error } = await timedWrite(
        supabase
          .from('track_matches')
          .upsert(batch, { onConflict: 'spotify_track_id,mp3_id' })
          .then(r => r),
        'auto-confirm Tier 1 batch'
      );
      if (error) {
        throw new Error(`Failed to auto-confirm Tier 1 matches after ${i} rows: ${error.message}`);
      }
    }

    console.log(`✅ Auto-confirmed ${rows.length} Tier 1 matches`);
    return rows.length;
  }

  /**
   * Confirm `mp3Id` as the local copy of a Spotify track, then reject the track's other
   * unreviewed suggestions. Fails if the track already has a confirmed row: undo that first.
   * Returns the confirmed row's id.
   */
  static async confirmMatch(
    spotifyLikedId: string,
    mp3Id: string,
    { method, confidence = null, source }: ConfirmMatchOptions
  ): Promise<string> {
    const reviewedAt = nowIso();
    const id = await upsertDecision(
      {
        spotify_track_id: spotifyLikedId,
        mp3_id: mp3Id,
        is_confirmed: true,
        match_method: method,
        match_confidence: confidence,
        source,
        reviewed_at: reviewedAt,
      },
      'confirm match'
    );
    await rejectUnreviewedSuggestions(spotifyLikedId, reviewedAt);
    return id;
  }

  /** Record that `mp3Id` is not the local copy of a Spotify track. Returns the row's id. */
  static async rejectCandidate(
    spotifyLikedId: string,
    mp3Id: string,
    { method, failureCategory = null, notes = null }: RejectCandidateOptions
  ): Promise<string> {
    return upsertDecision(
      {
        spotify_track_id: spotifyLikedId,
        mp3_id: mp3Id,
        is_confirmed: false,
        match_method: method,
        source: 'human',
        reviewed_at: nowIso(),
        failure_category: failureCategory,
        notes,
      },
      'reject candidate'
    );
  }

  /**
   * Confirm that a Spotify track has no local copy, then reject the track's other unreviewed
   * suggestions. Fails if the track already has a confirmed row. Returns the new row's id.
   */
  static async confirmTrueMissing(
    spotifyLikedId: string,
    { failureCategory = null, notes = null }: ConfirmMissingOptions = {}
  ): Promise<string> {
    const reviewedAt = nowIso();
    // A plain insert: mp3_id is NULL, and NULLs never conflict on (spotify_track_id, mp3_id).
    const { data, error } = await timedWrite(
      supabase
        .from('track_matches')
        .insert({
          spotify_track_id: spotifyLikedId,
          mp3_id: null,
          is_confirmed: true,
          match_method: 'manual',
          source: 'human',
          reviewed_at: reviewedAt,
          failure_category: failureCategory,
          notes,
        })
        .select('id')
        .single()
        .then(r => r),
      'confirm missing'
    );
    if (error) throw new Error(`Failed to confirm missing: ${error.message}`);

    await rejectUnreviewedSuggestions(spotifyLikedId, reviewedAt);
    return data.id;
  }

  /**
   * Delete a decision a person made (any row with `reviewed_at` set), so the track goes back
   * to the queue. Tier 1 rows from `bulkAutoConfirmTier1` can't be undone: reject them instead.
   */
  static async undoDecision(trackMatchId: string): Promise<void> {
    const { error, count } = await timedWrite(
      supabase
        .from('track_matches')
        .delete({ count: 'exact' })
        .eq('id', trackMatchId)
        .not('reviewed_at', 'is', null)
        .then(r => r),
      'undo decision'
    );
    if (error) throw new Error(`Failed to undo decision: ${error.message}`);
    if (count === 0) throw new Error(`No reviewed decision found with id ${trackMatchId}`);
  }
}
