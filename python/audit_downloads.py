#!/usr/bin/env python3
"""
Audit MP3 downloads (e.g. the slskd downloads folder) for tag problems.

Read-only: it opens files to read their tags and never writes them, so there
is no --apply flag. The report is the input for Mako Clean add-on rules
(MAK-194).

Checks, each with a count and up to 5 example file names:
  * Blank genre
  * Genre that doesn't map to a SuperGenre (needs --genre-map)
  * Album Artist starting with "Mixed by"
  * A URL or "www." in a text frame
  * iTunes normalization comment (iTunNORM)
  * ID3v1 tag present
  * Track-number prefix in Title ("01 - ", "A1. ")
  * Missing Artist or Title
  * Bitrate below --min-bitrate
  * Grouping already set by the uploader
  * Serato frames (GEOB) left over from the uploader's library

Then a list of distinct genres with counts, most common first.

Only MP3 files are audited. Other files are counted by extension and skipped.
"""

import argparse
import csv
import os
import re
import sys
from collections import Counter

from mutagen.mp3 import MP3

# Fix Windows console encoding
if os.name == 'nt':
    sys.stdout.reconfigure(encoding='utf-8')

MAX_EXAMPLES = 5
MIXED_BY_PREFIX = "mixed by "
URL_PATTERN = re.compile(r'https?://|www\.', re.IGNORECASE)
# "01 - Title", "1. Title", "A1. Title", "B2) Title". Up to 3 digits so that
# titles such as "1999 - Live" aren't flagged; a separator and a space so that
# "99 Problems" and "7.5 Miles" aren't either.
TRACK_PREFIX_PATTERN = re.compile(r'^\s*[A-Za-z]?\d{1,3}\s*[-.)]\s+')

CHECKS = [
    ('blank_genre', 'Blank genre'),
    ('unmapped_genre', "Genre doesn't map to a SuperGenre"),
    ('mixed_by', 'Album Artist starts with "Mixed by"'),
    ('url', 'URL or "www." in a text frame'),
    ('itunnorm', 'iTunes normalization comment (iTunNORM)'),
    ('id3v1', 'ID3v1 tag'),
    ('track_prefix', 'Track-number prefix in Title'),
    ('missing_artist_title', 'Missing Artist or Title'),
    ('low_bitrate', 'Bitrate below minimum'),
    ('grouping_set', 'Grouping already set'),
    ('serato', 'Serato frames (GEOB)'),
]


def load_genre_map(csv_path):
    """Load the Genre Tools CSV download into an ordered dict.

    Keys are lowercased and trimmed, as in Mako's useGenreMap. The CSV is
    ordered by spotify_genre, and dict order is kept, so the partial match
    below sees the same order as Mako.
    """
    genre_map = {}
    with open(csv_path, newline='', encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            genre = (row.get('spotify_genre') or '').strip().lower()
            super_genre = (row.get('super_genre') or '').strip()
            if genre and super_genre:
                genre_map[genre] = super_genre
    return genre_map


def map_to_super_genre(genres, genre_map):
    """Same rule as Mako's mapToSuperGenre (src/utils/superGenreMapping.ts).

    For each genre in order: exact match ignoring case, then a partial match
    where either string contains the other. The first hit wins.
    """
    for genre in genres:
        normalized = genre.lower().strip()
        if normalized in genre_map:
            return genre_map[normalized]
        for mapped, super_genre in genre_map.items():
            if mapped in normalized or normalized in mapped:
                return super_genre
    return None


def has_id3v1(filepath):
    """True if the file ends with a 128-byte ID3v1 tag."""
    with open(filepath, 'rb') as f:
        f.seek(0, os.SEEK_END)
        if f.tell() < 128:
            return False
        f.seek(-128, os.SEEK_END)
        return f.read(3) == b'TAG'


def first_text(tags, frame_id):
    """First non-blank text value of a frame, or ''."""
    if tags is None:
        return ''
    for frame in tags.getall(frame_id):
        for value in getattr(frame, 'text', []):
            if str(value).strip():
                return str(value).strip()
    return ''


def frame_texts(frame):
    """All text values a frame holds (text frames, COMM, TXXX, URL frames)."""
    values = [str(v) for v in getattr(frame, 'text', [])]
    url = getattr(frame, 'url', None)
    if url:
        values.append(str(url))
    return values


def audit_file(filepath, genre_map, min_bitrate):
    """Audit one MP3. Returns (set of check keys that fired, list of genres)."""
    audio = MP3(filepath)
    tags = audio.tags
    found = set()

    genres = []
    if tags is not None:
        for frame in tags.getall('TCON'):
            genres.extend(g.strip() for g in frame.genres if g.strip())

    if not genres:
        found.add('blank_genre')
    elif genre_map is not None and map_to_super_genre(genres, genre_map) is None:
        found.add('unmapped_genre')

    if first_text(tags, 'TPE2').lower().startswith(MIXED_BY_PREFIX):
        found.add('mixed_by')

    if not first_text(tags, 'TPE1') or not first_text(tags, 'TIT2'):
        found.add('missing_artist_title')

    if TRACK_PREFIX_PATTERN.match(first_text(tags, 'TIT2')):
        found.add('track_prefix')

    if first_text(tags, 'TIT1') or first_text(tags, 'GRP1'):
        found.add('grouping_set')

    if tags is not None:
        for frame in tags.values():
            frame_id = frame.FrameID
            if frame_id == 'GEOB' and str(frame.desc).lower().startswith('serato'):
                found.add('serato')
            if frame_id == 'COMM' and frame.desc == 'iTunNORM':
                found.add('itunnorm')
            if frame_id in ('APIC', 'GEOB', 'PRIV'):
                continue
            if any(URL_PATTERN.search(v) for v in frame_texts(frame)):
                found.add('url')

    if has_id3v1(filepath):
        found.add('id3v1')

    if audio.info.bitrate and audio.info.bitrate / 1000 < min_bitrate:
        found.add('low_bitrate')

    return found, genres


def collect_files(target, batch):
    """Return (mp3 paths, Counter of other extensions)."""
    if not batch:
        return [target], Counter()
    mp3s = []
    others = Counter()
    for root, _dirs, files in os.walk(target):
        for name in files:
            ext = os.path.splitext(name)[1].lower()
            if ext == '.mp3':
                mp3s.append(os.path.join(root, name))
            else:
                others[ext or '(no extension)'] += 1
    mp3s.sort()
    return mp3s, others


def run_audit(target, batch, genre_map, min_bitrate):
    mp3s, others = collect_files(target, batch)
    hits = {key: [] for key, _label in CHECKS}
    genre_counts = Counter()
    errors = []

    for filepath in mp3s:
        try:
            found, genres = audit_file(filepath, genre_map, min_bitrate)
        except Exception as e:  # noqa: BLE001 - report and keep going
            errors.append((filepath, str(e)))
            continue
        for key in found:
            hits[key].append(filepath)
        genre_counts.update(genres)

    base = target if batch else os.path.dirname(target)

    def display(path):
        return os.path.relpath(path, base) if base else path

    print(f"Audited {len(mp3s)} MP3 files in {target}")
    if others:
        skipped = ', '.join(f"{ext} {n}" for ext, n in others.most_common())
        print(f"Skipped {sum(others.values())} other files: {skipped}")
    print("=" * 80)

    for key, label in CHECKS:
        if key == 'unmapped_genre' and genre_map is None:
            print(f"\n{label}: not checked (use --genre-map <csv>)")
            continue
        if key == 'low_bitrate':
            label = f"{label} ({min_bitrate} kbps)"
        files = hits[key]
        print(f"\n{label}: {len(files)}")
        for path in files[:MAX_EXAMPLES]:
            print(f"    {display(path)}")
        if len(files) > MAX_EXAMPLES:
            print(f"    ... and {len(files) - MAX_EXAMPLES} more")

    print("\n" + "=" * 80)
    print(f"Distinct genres: {len(genre_counts)}")
    for genre, count in genre_counts.most_common():
        print(f"  {count:5}  {genre}")

    if errors:
        print("\n" + "=" * 80)
        print(f"Errors: {len(errors)}")
        for path, message in errors:
            print(f"    {display(path)}: {message}")

    return hits, genre_counts, errors


def main():
    parser = argparse.ArgumentParser(
        description='Audit MP3 downloads for tag problems (read-only).')
    parser.add_argument('file', nargs='?', help='A single MP3 file')
    parser.add_argument('--batch', metavar='DIRECTORY',
                        help='Audit every MP3 in a directory, recursively')
    parser.add_argument('--genre-map', metavar='CSV',
                        help='Genre map CSV downloaded from the Genre Tools page')
    parser.add_argument('--min-bitrate', type=int, default=256, metavar='KBPS',
                        help='Flag files below this bitrate (default 256)')
    args = parser.parse_args()

    if bool(args.file) == bool(args.batch):
        parser.print_help()
        print('\nExamples:')
        print('  python audit_downloads.py "track.mp3"')
        print('  python audit_downloads.py --batch "C:\\slskd\\downloads" '
              '--genre-map "spotify-genre-mapping.csv"')
        sys.exit(1)

    target = args.batch or args.file
    if args.batch and not os.path.isdir(target):
        print(f"Error: not a directory: {target}")
        sys.exit(1)
    if args.file and not os.path.isfile(target):
        print(f"Error: not a file: {target}")
        sys.exit(1)

    genre_map = None
    if args.genre_map:
        genre_map = load_genre_map(args.genre_map)
        print(f"Loaded {len(genre_map)} genre mappings from {args.genre_map}")

    run_audit(target, bool(args.batch), genre_map, args.min_bitrate)


if __name__ == '__main__':
    main()
