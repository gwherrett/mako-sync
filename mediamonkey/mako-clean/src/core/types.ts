/**
 * Types for the Mako Clean rule engine.
 *
 * Everything under src/core is pure: no MediaMonkey objects, so vitest can test it.
 * The MediaMonkey layer (src/actions_add.ts) reads track fields into TrackFields,
 * runs the rules, and writes the planned changes back.
 */

/** The track fields rules can read. Blank fields are ''. */
export interface TrackFields {
  /** MediaMonkey's Genre field: several genres in one string, joined by the multi-value separator */
  genre: string;
  /** Grouping (MediaMonkey's `track.groupDesc`), where Mako stores the SuperGenre */
  grouping: string;
  albumArtist: string;
}

/** The fields rules can change. */
export type EditableField = 'grouping' | 'albumArtist';

export const FIELD_LABELS: Record<EditableField, string> = {
  grouping: 'Grouping',
  albumArtist: 'Album Artist',
};

export interface ProposedChange {
  field: EditableField;
  value: string;
  /** Replaces a value that was already set (shown as an overwrite in the preview) */
  overwrite?: boolean;
}

export interface RuleResult {
  changes?: ProposedChange[];
  /** Why the rule left the track alone, when the user should know (e.g. an unmapped genre) */
  skipReason?: string;
}

export interface RuleContext {
  /** Genre -> SuperGenre, keys lowercased and trimmed, in Mako's order */
  genreMap: Map<string, string>;
  /** MediaMonkey's multi-value separator, e.g. "; " */
  genreSeparator: string;
}

/** A cleanup rule: track fields in, proposed changes out. */
export interface Rule {
  id: string;
  run(fields: Readonly<TrackFields>, ctx: RuleContext): RuleResult;
}

export interface TrackInput {
  id: string;
  /** "Artist - Title" */
  label: string;
  /** File name, to tell apart tracks with the same artist and title */
  file: string;
  fields: TrackFields;
}

export interface FieldChange {
  field: EditableField;
  from: string;
  to: string;
  overwrite: boolean;
}

export interface TrackPlan {
  id: string;
  label: string;
  file: string;
  changes: FieldChange[];
  skipReasons: string[];
}
