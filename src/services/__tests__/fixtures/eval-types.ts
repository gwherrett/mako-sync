/**
 * Types for the track matching eval system.
 *
 * Eval cases represent Spotify tracks that were reported as "missing" (unmatched).
 * Each case is annotated with whether it is truly missing or a false negative
 * (should have matched a local track), and if so, what category of mismatch caused it.
 */

/** Categories of matching failure for false negatives */
export type FailureCategory =
  | 'artist-mismatch'           // Artist names differ after normalization
  | 'artist-featuring'          // "Artist feat. X" vs "Artist"
  | 'artist-ampersand'          // "A & B" vs "A and B" vs "A, B"
  | 'title-mismatch'            // Titles differ after normalization
  | 'title-version-confusion'   // Mix/version info not correctly stripped
  | 'title-punctuation'         // Punctuation differences ("dont" vs "don't")
  | 'title-diacritics'          // Accent/diacritic differences
  | 'title-remaster-suffix'     // "- Remastered 2023" appended to title
  | 'title-abbreviation'        // "Pt." vs "Part", "Vol." vs "Volume"
  | 'primary-artist-extraction' // primary_artist field disagrees between sources
  | 'unknown';

/** A single eval case */
export interface EvalCase {
  /** Unique identifier for this test case */
  id: string;

  /** The Spotify track that was reported as "missing" */
  spotifyTrack: {
    id: string;
    title: string;
    artist: string;
    primary_artist: string | null;
    album: string | null;
    genre: string | null;
    super_genre: string | null;
  };

  /**
   * The local track that SHOULD match this Spotify track.
   * null = this is a TRUE missing track (correctly unmatched).
   */
  expectedLocalMatch: {
    id: string;
    title: string | null;
    artist: string | null;
    primary_artist: string | null;
    album: string | null;
    genre: string | null;
    file_path: string;
  } | null;

  /**
   * Is this a true positive (truly missing) or false negative (should have matched)?
   * - 'true-missing': Correctly identified as missing. No local file exists.
   * - 'false-negative': Should have matched. expectedLocalMatch must be non-null.
   */
  verdict: 'true-missing' | 'false-negative';

  /** Why did matching fail? Only relevant when verdict = 'false-negative'. */
  failureCategory: FailureCategory | null;

  /** Free-text notes explaining the mismatch for human reviewers */
  notes: string;

  /** Super genre for filtering eval runs by genre */
  superGenre: string | null;
}

/** Top-level fixture file structure */
export interface EvalFixtureFile {
  /** ISO timestamp when the fixture was exported */
  exportedAt: string;

  /** Description of this eval set */
  description: string;

  /** Number of cases */
  totalCases: number;

  /** The eval cases */
  cases: EvalCase[];
}
