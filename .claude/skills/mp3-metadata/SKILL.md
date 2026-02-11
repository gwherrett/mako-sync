---
name: mp3-metadata
description: Inspect MP3 file metadata including ID3 tags, audio quality info, and custom fields. Use when the user wants to examine an MP3 file's tags, check audio quality, or view comment/custom fields.
argument-hint: <path-to-mp3> [summary|easy|detailed|custom|tags]
allowed-tools: Bash, Read
---

Inspect MP3 metadata using the mutagen library with multiple viewing modes.

## Modes

| Mode | Description |
|------|-------------|
| `summary` | Quick overview: title, artist, album, genre, duration, bitrate (default) |
| `easy` | All common tags in human-readable format via EasyID3 |
| `detailed` | All raw ID3 tags plus file info (bitrate, sample rate, channels, encoder) |
| `custom` | Comment fields (COMM) and user-defined text fields (TXXX) only |
| `tags` | List all tag names supported by EasyID3 (no file needed) |

## Execution

Run the following command with the user-provided arguments:

```
python /workspaces/mako-sync/python/mp3_metadata_demo.py $ARGUMENTS
```

If no mode is specified, default to `summary`.

## Instructions

- Present results cleanly, grouping related information together
- For `detailed` mode, highlight any unusual or non-standard tags
- For `custom` mode, explain what each COMM and TXXX frame represents
- If tags appear missing or malformed, note this and suggest further investigation
- If comment field issues are detected, suggest using `/mp3-diagnose` for deeper analysis
