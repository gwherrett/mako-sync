-- Discogs Term Seed Data
-- Populates discogs_term_map_base with top-level Discogs genres and common styles.
-- Styles take priority over genres in compute_discogs_super_genre().
-- Use exact Discogs genre/style strings (case-sensitive match in the function).

INSERT INTO public.discogs_term_map_base (discogs_term, term_type, super_genre) VALUES

-- ============================================================
-- TOP-LEVEL GENRES (term_type = 'genre')
-- Broad Discogs categories — styles usually override these.
-- ============================================================
  ('Electronic',           'genre', 'Electronic'),
  ('Rock',                 'genre', 'Rock'),
  ('Jazz',                 'genre', 'Jazz'),
  ('Funk / Soul',          'genre', 'Soul-Funk'),
  ('Hip Hop',              'genre', 'Hip Hop'),
  ('Classical',            'genre', 'Orchestral'),
  ('Latin',                'genre', 'Latin'),
  ('Reggae',               'genre', 'Reggae-Dancehall'),
  ('Blues',                'genre', 'Blues'),
  ('Folk, World, & Country','genre','Folk'),
  ('Pop',                  'genre', 'Pop'),
  ('Non-Music',            'genre', 'Books & Spoken'),
  ('Children''s',          'genre', 'Other'),
  ('Stage & Screen',       'genre', 'Other'),
  ('Brass & Military',     'genre', 'Other'),

-- ============================================================
-- STYLES (term_type = 'style')
-- More specific — take priority over genre in resolution.
-- ============================================================

-- House
  ('House',                'style', 'House'),
  ('Deep House',           'style', 'House'),
  ('Tech House',           'style', 'House'),
  ('Acid House',           'style', 'House'),
  ('Chicago House',        'style', 'House'),
  ('Funky House',          'style', 'House'),
  ('Progressive House',    'style', 'House'),
  ('Electro House',        'style', 'House'),
  ('Tropical House',       'style', 'House'),
  ('Lo-Fi House',          'style', 'House'),
  ('Microhouse',           'style', 'House'),
  ('Ghetto House',         'style', 'House'),
  ('Hard House',           'style', 'House'),

-- UK Garage
  ('UK Garage',            'style', 'UK Garage'),
  ('2-Step',               'style', 'UK Garage'),
  ('Speed Garage',         'style', 'UK Garage'),
  ('Bassline',             'style', 'UK Garage'),
  ('4x4',                  'style', 'UK Garage'),

-- Drum & Bass
  ('Drum n Bass',          'style', 'Drum & Bass'),
  ('Jungle',               'style', 'Drum & Bass'),
  ('Liquid',               'style', 'Drum & Bass'),
  ('Neurofunk',            'style', 'Drum & Bass'),
  ('Jump Up',              'style', 'Drum & Bass'),
  ('Darkstep',             'style', 'Drum & Bass'),
  ('Techstep',             'style', 'Drum & Bass'),

-- Bass
  ('Dubstep',              'style', 'Bass'),
  ('Grime',                'style', 'Bass'),
  ('Brostep',              'style', 'Bass'),
  ('Future Bass',          'style', 'Bass'),
  ('Wave',                 'style', 'Bass'),

-- Disco
  ('Disco',                'style', 'Disco'),
  ('Nu-Disco',             'style', 'Disco'),
  ('Italo-Disco',          'style', 'Disco'),
  ('Euro-Disco',           'style', 'Disco'),

-- Dance
  ('Dance',                'style', 'Dance'),
  ('Hi NRG',               'style', 'Dance'),
  ('Eurodance',            'style', 'Dance'),

-- Electronic (general)
  ('Techno',               'style', 'Electronic'),
  ('Industrial',           'style', 'Electronic'),
  ('EBM',                  'style', 'Electronic'),
  ('Ambient',              'style', 'Electronic'),
  ('IDM',                  'style', 'Electronic'),
  ('Electro',              'style', 'Electronic'),
  ('Trance',               'style', 'Electronic'),
  ('Breakbeat',            'style', 'Electronic'),
  ('Breaks',               'style', 'Electronic'),
  ('Hardcore',             'style', 'Electronic'),
  ('Gabber',               'style', 'Electronic'),
  ('Hard Trance',          'style', 'Electronic'),
  ('Minimal',              'style', 'Electronic'),
  ('Drone',                'style', 'Electronic'),
  ('Electronica',          'style', 'Electronic'),
  ('Downtempo',            'style', 'Electronic'),
  ('Trip Hop',             'style', 'Electronic'),
  ('Future Garage',        'style', 'Electronic'),
  ('Leftfield',            'style', 'Electronic'),
  ('Synthpop',             'style', 'Electronic'),
  ('Synth-pop',            'style', 'Electronic'),

-- Hip Hop
  ('Hip-Hop',              'style', 'Hip Hop'),
  ('Rap',                  'style', 'Hip Hop'),
  ('Boom Bap',             'style', 'Hip Hop'),
  ('Trap',                 'style', 'Hip Hop'),
  ('Conscious',            'style', 'Hip Hop'),
  ('Gangsta',              'style', 'Hip Hop'),
  ('G-Funk',               'style', 'Hip Hop'),
  ('Crunk',                'style', 'Hip Hop'),
  ('Drill',                'style', 'Hip Hop'),
  ('Cloud Rap',            'style', 'Hip Hop'),
  ('Alternative Hip Hop',  'style', 'Hip Hop'),
  ('Dirty South',          'style', 'Hip Hop'),

-- Soul-Funk
  ('Soul',                 'style', 'Soul-Funk'),
  ('Funk',                 'style', 'Soul-Funk'),
  ('R&B',                  'style', 'Soul-Funk'),
  ('Gospel',               'style', 'Soul-Funk'),
  ('Neo Soul',             'style', 'Soul-Funk'),
  ('Contemporary R&B',     'style', 'Soul-Funk'),
  ('Quiet Storm',          'style', 'Soul-Funk'),
  ('Boogie',               'style', 'Soul-Funk'),
  ('Motown',               'style', 'Soul-Funk'),
  ('Philly Soul',          'style', 'Soul-Funk'),
  ('New Jack Swing',       'style', 'Soul-Funk'),

-- Indie-Alternative
  ('Indie Rock',           'style', 'Indie-Alternative'),
  ('Indie Pop',            'style', 'Indie-Alternative'),
  ('Alternative Rock',     'style', 'Indie-Alternative'),
  ('Shoegaze',             'style', 'Indie-Alternative'),
  ('Post-Punk',            'style', 'Indie-Alternative'),
  ('Post-Rock',            'style', 'Indie-Alternative'),
  ('Britpop',              'style', 'Indie-Alternative'),
  ('Grunge',               'style', 'Indie-Alternative'),
  ('Emo',                  'style', 'Indie-Alternative'),
  ('Dream Pop',            'style', 'Indie-Alternative'),
  ('Lo-Fi',                'style', 'Indie-Alternative'),
  ('New Wave',             'style', 'Indie-Alternative'),
  ('Punk',                 'style', 'Indie-Alternative'),
  ('Art Rock',             'style', 'Indie-Alternative'),
  ('Prog Rock',            'style', 'Indie-Alternative'),
  ('Psychedelic Rock',     'style', 'Indie-Alternative'),
  ('Power Pop',            'style', 'Indie-Alternative'),
  ('Math Rock',            'style', 'Indie-Alternative'),
  ('Chamber Pop',          'style', 'Indie-Alternative'),

-- Rock
  ('Rock',                 'style', 'Rock'),
  ('Classic Rock',         'style', 'Rock'),
  ('Hard Rock',            'style', 'Rock'),
  ('Glam',                 'style', 'Rock'),
  ('Soft Rock',            'style', 'Rock'),
  ('Pub Rock',             'style', 'Rock'),
  ('Blues Rock',           'style', 'Rock'),
  ('Country Rock',         'style', 'Country'),

-- Metal
  ('Heavy Metal',          'style', 'Metal'),
  ('Thrash',               'style', 'Metal'),
  ('Death Metal',          'style', 'Metal'),
  ('Black Metal',          'style', 'Metal'),
  ('Doom Metal',           'style', 'Metal'),
  ('Speed Metal',          'style', 'Metal'),
  ('Nu Metal',             'style', 'Metal'),
  ('Metalcore',            'style', 'Metal'),
  ('Grindcore',            'style', 'Metal'),
  ('Power Metal',          'style', 'Metal'),
  ('Sludge Metal',         'style', 'Metal'),

-- Jazz
  ('Jazz',                 'style', 'Jazz'),
  ('Bebop',                'style', 'Jazz'),
  ('Hard Bop',             'style', 'Jazz'),
  ('Free Jazz',            'style', 'Jazz'),
  ('Cool Jazz',            'style', 'Jazz'),
  ('Modal',                'style', 'Jazz'),
  ('Jazz-Funk',            'style', 'Jazz'),
  ('Jazz-Rock',            'style', 'Jazz'),
  ('Smooth Jazz',          'style', 'Jazz'),
  ('Big Band',             'style', 'Jazz'),
  ('Swing',                'style', 'Jazz'),
  ('Vocal Jazz',           'style', 'Jazz'),
  ('Bossa Nova',           'style', 'Jazz'),
  ('Ethio-Jazz',           'style', 'Jazz'),

-- Blues
  ('Blues',                'style', 'Blues'),
  ('Delta Blues',          'style', 'Blues'),
  ('Chicago Blues',        'style', 'Blues'),
  ('Electric Blues',       'style', 'Blues'),
  ('Country Blues',        'style', 'Blues'),
  ('Jump Blues',           'style', 'Blues'),
  ('Rhythm & Blues',       'style', 'Blues'),

-- Country / Folk
  ('Country',              'style', 'Country'),
  ('Bluegrass',            'style', 'Country'),
  ('Americana',            'style', 'Country'),
  ('Alt-Country',          'style', 'Country'),
  ('Honky Tonk',           'style', 'Country'),
  ('Outlaw Country',       'style', 'Country'),
  ('Folk',                 'style', 'Folk'),
  ('Contemporary Folk',    'style', 'Folk'),
  ('Folk Rock',            'style', 'Folk'),
  ('Singer/Songwriter',    'style', 'Folk'),
  ('Acoustic',             'style', 'Folk'),
  ('Celtic',               'style', 'Folk'),
  ('Traditional',          'style', 'Folk'),

-- Reggae-Dancehall
  ('Reggae',               'style', 'Reggae-Dancehall'),
  ('Dancehall',            'style', 'Reggae-Dancehall'),
  ('Ska',                  'style', 'Reggae-Dancehall'),
  ('Rocksteady',           'style', 'Reggae-Dancehall'),
  ('Dub',                  'style', 'Reggae-Dancehall'),
  ('Roots Reggae',         'style', 'Reggae-Dancehall'),
  ('Lovers Rock',          'style', 'Reggae-Dancehall'),
  ('Ragga',                'style', 'Reggae-Dancehall'),

-- Latin
  ('Salsa',                'style', 'Latin'),
  ('Cumbia',               'style', 'Latin'),
  ('Merengue',             'style', 'Latin'),
  ('Bachata',              'style', 'Latin'),
  ('Samba',                'style', 'Latin'),
  ('Tango',                'style', 'Latin'),
  ('Latin Jazz',           'style', 'Latin'),
  ('Mambo',                'style', 'Latin'),
  ('Cha-Cha',              'style', 'Latin'),
  ('Beguine',              'style', 'Latin'),

-- Pop
  ('Pop',                  'style', 'Pop'),
  ('Bubblegum',            'style', 'Pop'),
  ('Teen Pop',             'style', 'Pop'),
  ('K-Pop',                'style', 'Pop'),
  ('J-Pop',                'style', 'Pop'),
  ('Europop',              'style', 'Pop'),
  ('Ballad',               'style', 'Pop'),

-- Orchestral / Classical
  ('Classical',            'style', 'Orchestral'),
  ('Baroque',              'style', 'Orchestral'),
  ('Romantic',             'style', 'Orchestral'),
  ('Opera',                'style', 'Orchestral'),
  ('Chamber Music',        'style', 'Orchestral'),
  ('Orchestral',           'style', 'Orchestral'),
  ('Choral',               'style', 'Orchestral'),
  ('Contemporary',         'style', 'Orchestral'),
  ('Minimalism',           'style', 'Orchestral'),
  ('Symphony',             'style', 'Orchestral'),

-- World
  ('African',              'style', 'World'),
  ('Afrobeat',             'style', 'World'),
  ('Highlife',             'style', 'World'),
  ('Soukous',              'style', 'World'),
  ('Middle Eastern',       'style', 'World'),
  ('Indian',               'style', 'World'),
  ('Asian',                'style', 'World'),
  ('Fado',                 'style', 'World'),
  ('Flamenco',             'style', 'World'),
  ('Gypsy Jazz',           'style', 'World'),

-- Books & Spoken
  ('Spoken Word',          'style', 'Books & Spoken'),
  ('Comedy',               'style', 'Books & Spoken'),
  ('Speech',               'style', 'Books & Spoken'),
  ('Audio Book',           'style', 'Books & Spoken'),

-- Seasonal
  ('Christmas',            'style', 'Seasonal'),
  ('Holiday',              'style', 'Seasonal')

ON CONFLICT (discogs_term) DO NOTHING;
