---
name: mp3-fix-comments
description: Fix MP3 comment field conflicts by removing iTunes normalization data and stale ID3v1 comment frames while preserving Songs-DB_Custom1. Supports single file and batch directory mode. Always defaults to dry-run for safety.
argument-hint: <file.mp3 | --batch dir> [--apply]
allowed-tools: Bash, Read
---

Fix comment field conflicts in MP3 files. This removes problematic COMM frames (ID3v1 Comment, empty-description XXX) while preserving Songs-DB_Custom1 fields used by MediaMonkey.

## Argument Handling

The arguments map directly to the Python script:

| Example | Behavior |
|---------|----------|
| `song.mp3` | Dry-run on a single file (shows what would change) |
| `song.mp3 --apply` | Apply changes to a single file |
| `--batch /music/dir` | Dry-run on all MP3s recursively in directory |
| `--batch /music/dir --apply` | Apply changes to all MP3s in directory |

## Execution

Run the following command with the user-provided arguments:

```
python /workspaces/mako-sync/python/fix_comments.py $ARGUMENTS
```

## Instructions

- **Default is always dry-run.** If the user did not pass `--apply`, emphasize that no changes were made and show what would happen.
- When `--apply` is used, confirm that changes were applied and summarize what was removed vs preserved.
- For batch mode, report the total number of files scanned and how many needed fixing.
- After a dry-run, prompt the user: "Run again with `--apply` to make these changes."
- After applying fixes, suggest running `/mp3-diagnose` on the file to verify the result.
- Warn clearly if batch mode with `--apply` will modify many files.
