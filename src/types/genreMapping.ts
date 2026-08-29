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

// Hardcoded "dance music" grouping for cross-filtering Spotify liked vs local files.
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

// Sentinel value for the "Dance (all)" option in SuperGenre filter dropdowns.
export const DANCE_ALL_VALUE = '__dance_all__';

export const getSuperGenreFilterLabel = (value: string): string =>
  value === DANCE_ALL_VALUE ? 'Dance (all)' : value;

// Applies a SuperGenre filter value to a Supabase query builder, expanding the
// "Dance (all)" sentinel into an `.in()` match against DANCE_SUPER_GENRES.
export const applySuperGenreFilter = (query: any, value?: string | null): any => {
  if (!value || value === 'all') return query;
  if (value === DANCE_ALL_VALUE) return query.in('super_genre', DANCE_SUPER_GENRES);
  return query.eq('super_genre', value);
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
