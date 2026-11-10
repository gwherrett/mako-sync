export type SuperGenre = 
  | 'Bass'
  | 'Blues'
  | 'Books & Spoken'
  | 'Country'
  | 'Dance'
  | 'Disco'
  | 'Drum & Bass'
  | 'Electronic'
  | 'Folk'
  | 'Hip Hop'
  | 'House'
  | 'Indie-Alternative'
  | 'Jazz'
  | 'Latin'
  | 'Metal'
  | 'Orchestral'
  | 'Other'
  | 'Pop'
  | 'Reggae-Dancehall'
  | 'Rock'
  | 'Seasonal'
  | 'Soul-Funk'
  | 'Soundtrack'
  | 'Urban'
  | 'World';

export const SUPER_GENRES: SuperGenre[] = [
  'Bass',
  'Blues',
  'Books & Spoken',
  'Country',
  'Dance',
  'Disco',
  'Drum & Bass',
  'Electronic',
  'Folk',
  'Hip Hop',
  'House',
  'Indie-Alternative',
  'Jazz',
  'Latin',
  'Metal',
  'Orchestral',
  'Other',
  'Pop',
  'Reggae-Dancehall',
  'Rock',
  'Seasonal',
  'Soul-Funk',
  'Soundtrack',
  'Urban',
  'World'
];

// Hardcoded "SuperDJ" grouping for cross-filtering Spotify liked vs local files.
// See MAK-150. Not derived from genre-mapping data — a fixed editorial set.
export const DANCE_SUPER_GENRES: SuperGenre[] = [
  'Bass',
  'Dance',
  'Disco',
  'Drum & Bass',
  'Electronic',
  'House',
  'Reggae-Dancehall',
  'Soul-Funk',
  'Urban',
];

// Sentinel value for the "SuperDJ" option in SuperGenre filter dropdowns.
export const DANCE_ALL_VALUE = '__dance_all__';

// Display label for the DANCE_ALL_VALUE option.
export const SUPERDJ_LABEL = 'SuperDJ';

export const getSuperGenreFilterLabel = (value: string): string =>
  value === DANCE_ALL_VALUE ? SUPERDJ_LABEL : value;

/** The two filter methods applySuperGenreFilter calls on a Supabase query builder. */
interface SuperGenreFilterable {
  eq(column: 'super_genre', value: string): this;
  in(column: 'super_genre', values: readonly string[]): this;
}

// Applies a SuperGenre filter value to a Supabase query builder, expanding the
// "SuperDJ" sentinel into an `.in()` match against DANCE_SUPER_GENRES.
// Q is left unconstrained: checking a Supabase builder against SuperGenreFilterable makes
// TypeScript give up (TS2589), so the builder is viewed through the interface internally.
export const applySuperGenreFilter = <Q>(query: Q, value?: string | null): Q => {
  if (!value || value === 'all') return query;
  const filterable = query as unknown as SuperGenreFilterable;
  if (value === DANCE_ALL_VALUE) return filterable.in('super_genre', DANCE_SUPER_GENRES) as unknown as Q;
  return filterable.eq('super_genre', value) as unknown as Q;
};

export interface GenreMapping {
  spotify_genre: string;
  super_genre: SuperGenre | null;
  is_overridden: boolean;
}

export interface GenreMappingOverride {
  id: string;
  user_id: string;
  spotify_genre: string;
  super_genre: SuperGenre;
  updated_at: string;
}
