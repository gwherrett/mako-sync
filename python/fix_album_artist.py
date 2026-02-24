#!/usr/bin/env python3
"""
Remove 'Mixed By' prefix from Album Artist tags in MP3 files.
For example: "Mixed by DJ Mako" -> "DJ Mako"
"""

import sys
import os
import glob
from mutagen.easyid3 import EasyID3

# Fix Windows console encoding
if os.name == 'nt':
    sys.stdout.reconfigure(encoding='utf-8')

PREFIX = "mixed by "


def fix_album_artist(filepath, dry_run=True):
    """Remove 'Mixed By' prefix from Album Artist if present."""
    try:
        audio = EasyID3(filepath)
    except Exception as e:
        print(f"  Error reading: {filepath} - {e}")
        return False

    albumartist_list = audio.get('albumartist')
    if not albumartist_list:
        return False

    albumartist = albumartist_list[0]
    if not albumartist.lower().startswith(PREFIX):
        return False

    new_value = albumartist[len(PREFIX):]
    print(f"  {os.path.basename(filepath)}")
    print(f"    '{albumartist}' -> '{new_value}'")

    if not dry_run:
        audio['albumartist'] = [new_value]
        audio.save()

    return True


def batch_fix(directory, dry_run=True):
    """Fix all MP3 files in a directory recursively."""
    pattern = os.path.join(directory, "**", "*.mp3")
    files = glob.glob(pattern, recursive=True)

    print(f"Scanning {len(files)} MP3 files in {directory}")
    print("=" * 80)

    fixed_count = 0
    error_count = 0

    for filepath in files:
        try:
            if fix_album_artist(filepath, dry_run):
                fixed_count += 1
        except Exception as e:
            print(f"  Error: {filepath} - {e}")
            error_count += 1

    print("\n" + "=" * 80)
    mode_label = "DRY RUN" if dry_run else "APPLIED"
    print(f"[{mode_label}] {fixed_count} files {'would be ' if dry_run else ''}modified, "
          f"{len(files) - fixed_count - error_count} skipped, {error_count} errors")
    if dry_run and fixed_count > 0:
        print("Run with --apply to make changes")
    print("=" * 80)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage:")
        print("  Single file: python fix_album_artist.py <file.mp3> [--apply]")
        print("  Batch mode:  python fix_album_artist.py --batch <directory> [--apply]")
        print("\nOptions:")
        print("  --apply     Actually make changes (default is dry-run)")
        print("\nExamples:")
        print('  python fix_album_artist.py "mix.mp3"')
        print('  python fix_album_artist.py --batch "C:\\Music\\5_Mixes" --apply')
        sys.exit(1)

    apply_changes = '--apply' in sys.argv
    dry_run = not apply_changes

    if '--batch' in sys.argv:
        batch_idx = sys.argv.index('--batch')
        if batch_idx + 1 < len(sys.argv):
            directory = sys.argv[batch_idx + 1]
            if directory == '--apply':
                print("Error: --batch requires a directory path")
                sys.exit(1)
            batch_fix(directory, dry_run)
        else:
            print("Error: --batch requires a directory path")
            sys.exit(1)
    else:
        filepath = sys.argv[1]
        if filepath == '--apply':
            print("Error: provide a file path")
            sys.exit(1)
        result = fix_album_artist(filepath, dry_run)
        if not result:
            print("No 'Mixed By' prefix found in Album Artist tag")
        elif dry_run:
            print("\nRun with --apply to make changes")
