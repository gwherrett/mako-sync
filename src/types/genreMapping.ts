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
  'Urban',
  'World'
];

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
