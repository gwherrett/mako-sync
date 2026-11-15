# slskd Reference

> **Reference**: How to install slskd on Windows, connect Mako Sync to it, push missing tracks to it, and download them.

**Status**: Active
**Last Updated**: 14 November 2026

---

## Overview

This is the one place for slskd: install, config, connecting Mako, the push, and downloading what Mako pushes. Read it to set up a new machine, or before you change `src/services/slskdClient.service.ts` or the push in Review Matches.

How it fits together: Mako calls slskd's REST API from the browser, on the PC that runs slskd. A push starts one slskd search per track (`Artist - Title`), or one per album (`Artist - Album`). slskd has no wishlist and downloads nothing by itself, so you pick and download the files on slskd's Searches page. They land in the downloads folder, which the MediaMonkey 5 Cleanup project picks up from there.

**Version:** slskd **0.26.2** (released 23 October 2026, commit `e472ecd`). The facts in [How slskd behaves](#how-slskd-behaves) come from reading its source and docs. Items marked **confirmed live** were checked against the slskd installed on this PC in November 2026.

---

## Quick reference

Run the commands in PowerShell.

| What | How |
|------|-----|
| Web UI | <http://localhost:5030> |
| API docs (Swagger) | <http://localhost:5030/swagger> |
| Endpoint to enter on Mako's Options page | `http://localhost:5030` |
| Start | `Start-ScheduledTask slskd` |
| Stop | `Stop-Process -Name slskd`. `Stop-ScheduledTask` doesn't stop it |
| Restart, for example after a config change | `Stop-Process -Name slskd; Start-Sleep 3; Start-ScheduledTask slskd` |
| Check it's running | `Get-Process slskd` |
| Config | `%LOCALAPPDATA%\slskd\slskd.yml` |
| Logs | `%LOCALAPPDATA%\slskd\logs` (one file per day) |
| Downloads folder | `C:\Supercollection\99_TO_BE_CLEANED\Soulseek Downloads\complete` |

Port 5030 is the web UI and API. Port 50300 is for other Soulseek users to connect to you; don't open it in a browser.

---

## Set up a new machine

Do these in order. Each step links to the details.

1. [Install slskd](#install-slskd) into `C:\Tools\slskd`, and create the config and download folders.
2. [Write `slskd.yml`](#config): your Soulseek account, a web UI login, an API key for Mako, and the folders.
3. [Make it start with Windows](#starting-with-windows) with a Task Scheduler task.
4. [Start it and check it](#start-and-check): allow the firewall prompt, log in to the web UI, and check it's logged in to Soulseek.
5. [Connect Mako Sync](#connecting-mako-sync) on dev and on production.
6. [Push one track](#pushing-tracks) from Review Matches, and [download it](#downloading-pushed-tracks) in slskd.

You need Chrome 142 or later and a Soulseek account. If you don't have one, choose a username and password: the Soulseek server creates the account the first time slskd logs in with it.

---

## Install on Windows

Installed on this PC on 14 November 2026 (MAK-212):

| What | Where |
|------|-------|
| Version | 0.26.2, from `slskd-0.26.2-win-x64.zip`. Its SHA-256 (`ffe186ec…5cd9c48f0`) matched the digest on the GitHub release |
| Program files | `C:\Tools\slskd`. No version in the folder name, so the startup task path never changes |
| Config | `%LOCALAPPDATA%\slskd\slskd.yml`, slskd's default app directory |
| Data and logs | `%LOCALAPPDATA%\slskd\data` and `%LOCALAPPDATA%\slskd\logs` |
| Downloads | `C:\Supercollection\99_TO_BE_CLEANED\Soulseek Downloads\complete`. The MM5 Cleanup project monitors this folder (MAK-194, MAK-201) |
| Incomplete | `C:\Supercollection\99_TO_BE_CLEANED\Soulseek Downloads\downloading` |
| Share | `C:\Supercrates` without its `.claude` and `.vscode` folders: 68 directories, 9,020 files |
| Web UI and API | `http://localhost:5030`, with HTTPS off. It's bound to `127.0.0.1` and `::1`, so other devices on the network can't reach it, even though the firewall allows `slskd.exe` in |
| Soulseek listen port | 50300 |
| Firewall | Two inbound Allow rules for `C:\Tools\slskd\slskd.exe`, on the Public profile, from the prompt at first start |

### Install slskd

1. Download the latest `win-x64` zip from [slskd releases](https://github.com/slskd/slskd/releases) (0.26.2 when this was written). Check its hash against the SHA-256 digest on the release page:

   ```powershell
   Get-FileHash .\slskd-0.26.2-win-x64.zip
   ```

2. Extract it so that `slskd.exe` sits directly in `C:\Tools\slskd`, next to the `wwwroot` folder.
3. Create the config folder and the download folders:

   ```powershell
   New-Item -ItemType Directory -Force "$env:LOCALAPPDATA\slskd",
     'C:\Supercollection\99_TO_BE_CLEANED\Soulseek Downloads\complete',
     'C:\Supercollection\99_TO_BE_CLEANED\Soulseek Downloads\downloading'
   ```

   If the new machine keeps music somewhere else, use its folders here and in `slskd.yml`.

### Config

1. Generate an API key for Mako. slskd prints a random secret of the length you give:

   ```powershell
   & C:\Tools\slskd\slskd.exe --generate-secret 32
   ```

2. Save the file below as `%LOCALAPPDATA%\slskd\slskd.yml`. Fill in your Soulseek username and password, a username and password for the web UI (not the default `slskd` / `slskd`), and the key from step 1.
3. Keep every Windows path in single quotes with backslashes. With forward slashes, downloads and the share both fail: see [Windows pitfalls](#windows-pitfalls).
4. Copy the finished file to `G:\My Drive\Dev-Config-Backup\slskd\`. The `slskd.yml` there was still the April 2026 file in the old 0.24 layout when this was written, and 0.26.2 won't start with it.

```yaml
soulseek:
  username: <your Soulseek username>
  password: <your Soulseek password>
  listen_port: 50300

directories:
  # Backslashes required: slskd rejects every download with 'Only absolute paths may be specified' if these use C:/
  downloads: 'C:\Supercollection\99_TO_BE_CLEANED\Soulseek Downloads\complete'
  incomplete: 'C:\Supercollection\99_TO_BE_CLEANED\Soulseek Downloads\downloading'

shares:
  # Windows paths need backslashes: with C:/ slskd fails to mask file paths and shares 0 files.
  directories:
    - 'C:\Supercrates'
    - '!C:\Supercrates\.claude'
    - '!C:\Supercrates\.vscode'
  filters:
    - \.ini$
    - Thumbs.db$
    - desktop.ini$
    - '\\\.[^\\]+(\\|$)' # anything in a dot-folder, and dotfiles

transfers:
  upload:
    slots: 20
    speed_limit: 1000 # KiB/s
  download:
    slots: 500
    retry:
      attempts: 3
  groups:
    default:
      upload:
        priority: 500
        strategy: roundrobin
        slots: 10
    leechers:
      thresholds:
        files: 1
        directories: 1
      upload:
        priority: 999
        strategy: roundrobin
        slots: 1
        speed_limit: 100

web:
  port: 5030
  ip_address: "127.0.0.1,::1" # web UI and API only reachable from this PC
  https:
    disabled: true
  authentication:
    username: <web UI username>
    password: <web UI password>
    api_keys:
      mako-sync:
        key: <the key from slskd --generate-secret>
        role: ReadWrite
        cidr: 127.0.0.1/32,::1/128

feature:
  swagger: true

# retention.search is deliberately left unset, so saved searches are kept
# and Mako's duplicate check can see them.
```

This is the config running on this PC, with secrets removed. What each part is for:

- **`web.authentication.api_keys`** holds Mako's key. Keys go here, not under `web.api_keys`. `role: ReadWrite` and the loopback-only `cidr` are explained in [answer 6](#6-api-keys-in-slskdyml).
- **`web.ip_address`** limits the web UI and API to this PC. By default slskd listens on every network interface. Mako runs in a browser on this PC, so nothing else needs access.
- **`feature.swagger: true`** turns on the API docs at `/swagger`.
- **`retention.search` is left unset.** If slskd pruned old searches, Mako's duplicate check would forget them and push those tracks again.
- **`transfers.download.retry.attempts: 3`** retries failed downloads.

#### Migrating from the 0.24 backup

This PC's config was migrated from the April 2026 backup, which used the 0.24 layout. If you start from an old file instead of the template, make the same changes:

- **Move `global` to `transfers` and `groups` to `transfers.groups`.** From 0.25.0, slskd refuses to start with the old keys ([0.25.0 release notes](https://github.com/slskd/slskd/releases/tag/0.25.0)).
- **Drop five keys that never existed:** `searches.response_limit`, `downloads.maximum_downloads`, `downloads.retry_attempts`, `logger.level` and `logger.file`. They aren't options in 0.24.5 or 0.26.2, so slskd always ignored them.
- **Write every Windows path with backslashes**, exclude `.claude` and `.vscode`, and add the dot-folder filter.
- **Give the `mako-sync` key `role: ReadWrite` and the loopback-only `cidr`.**
- **Add `feature.swagger: true` and `web.ip_address`.**

### Starting with Windows

slskd runs from a Task Scheduler task named `slskd`. It starts at logon for your account and runs `conhost.exe --headless "C:\Tools\slskd\slskd.exe"` from `C:\Tools\slskd`, so no console window opens. It has no time limit, runs on battery, and restarts up to 3 times, 1 minute apart, if the task fails.

To create it on a new machine, run this in PowerShell. If it says access is denied, run it again in PowerShell as administrator.

```powershell
$action = New-ScheduledTaskAction -Execute 'C:\Windows\System32\conhost.exe' `
  -Argument '--headless "C:\Tools\slskd\slskd.exe"' -WorkingDirectory 'C:\Tools\slskd'
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName slskd -Description 'slskd (Soulseek client) for Mako Sync' `
  -Action $action -Trigger $trigger -Settings $settings
```

These settings match the task on this PC (checked with `Export-ScheduledTask slskd` on 14 November 2026).

| To | Run |
|----|-----|
| Start | `Start-ScheduledTask slskd` |
| Stop | `Stop-Process -Name slskd`. `Stop-ScheduledTask` only stops the `conhost` wrapper and leaves `slskd.exe` running |
| Apply a config change | Stop, then start. slskd rereads most options while it runs, but share changes only take effect after the rescan at startup |

### Start and check

1. Start it: `Start-ScheduledTask slskd`. Then `Get-Process slskd` should list it.
2. The first time, Windows Defender Firewall asks whether to let `slskd.exe` through. Allow it, so other Soulseek users can connect to you on port 50300.
3. Open the newest file in `%LOCALAPPDATA%\slskd\logs`. If slskd stopped straight away, the reason is there, usually a config key in the wrong place.
4. Open <http://localhost:5030> and log in with the web UI username and password from `slskd.yml`. The top bar shows whether slskd is connected to the Soulseek server.
5. After the share scan finishes, check the share in the web UI. It should list the music folders and no `.claude` or `.vscode` folders.

[Connecting Mako Sync](#connecting-mako-sync) then checks the Soulseek login for you: **Connected** means slskd is logged in.

### Upgrading

1. Download the new `win-x64` zip. Check its SHA-256 against the digest on the GitHub release.
2. Stop slskd: `Stop-Process -Name slskd`.
3. Replace the contents of `C:\Tools\slskd`. The config and data in `%LOCALAPPDATA%\slskd` aren't touched.
4. Start it: `Start-ScheduledTask slskd`. Then check the newest file in `%LOCALAPPDATA%\slskd\logs` for config errors. slskd exits at startup when a config key has moved, as it did in 0.25.0.
5. Read the release notes for changes to searches or the API before relying on the push. Check [How slskd behaves](#how-slskd-behaves) against the new version.

### Windows pitfalls

- **Use backslashes in every Windows path in `slskd.yml`.** Forward slashes broke two things on first start, in different ways:
  - **Downloads:** with `C:/…` download folders, searches work but every download fails straight away with "Only absolute paths may be specified (Parameter 'filename')". In the web UI, the queue-position request then returns `500`. Before writing a file, slskd checks `Path.GetFullPath(filename) != filename` ([FileService.cs:142](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Files/FileService.cs#L142)). On Windows, `GetFullPath` rewrites `/` as `\`, so the two never match.
  - **Share:** with `C:/Supercrates`, slskd 0.26.2 scanned 9,022 files but shared 0. It converts directory names to the share name (`Supercrates\…`) from paths that keep the configured prefix. File names come from `FileInfo.FullName`, which Windows rewrites with backslashes, so `ReplaceFirst("C:/Supercrates", …)` never matched ([ShareScanner.cs:340](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Shares/ShareScanner.cs#L340)). Browsing then shows no files, and search results can still return files under their full local path.
- **Keep non-music folders out of the share.** `C:\Supercrates` has `.claude` and `.vscode` folders with editor settings in them. They're excluded by name, and the dot-folder filter catches any new one. Check `GET /api/v0/shares/{id}/contents` after changing the share.

---

## Connecting Mako Sync

Checked on 14 November 2026 (MAK-213) with Chrome 157, on dev (`http://localhost:8080`) and production (`https://mako-sync.vercel.app`). Both connect with no change to slskd or Mako.

Mako calls slskd from the browser, so this only works in a browser on the PC that runs slskd. slskd only listens on loopback, and on any other device `localhost` means that device.

### Steps

Do these once on dev and once on production. Each site keeps its own copy of the config.

1. Check slskd is running: `Get-Process slskd`. If it isn't, run `Start-ScheduledTask slskd`.
2. Copy the API key to the clipboard. In PowerShell:

   ```powershell
   (Select-String "$env:LOCALAPPDATA\slskd\slskd.yml" -Pattern '^\s+key:\s*[''"]?([^''"\s]+)').Matches[0].Groups[1].Value | Set-Clipboard
   ```

   This takes the first `key:` line, which is the `mako-sync` key under `web.authentication.api_keys`. You can also open `slskd.yml` and copy the value without the quotes.
3. Open the Options page (`/security`). In **slskd Integration**, enter `http://localhost:5030` as the API Endpoint, and paste the key. Leave **Search Query Format** on **Primary artist only** (see [Pushing tracks](#pushing-tracks)).
4. Click **Save**. It tests the connection, saves the config, and shows the **Connected** badge. **Test Connection** only tests: it doesn't save or change the badge. Both show the result under the buttons. "Connected" means slskd is running and logged in to Soulseek (`server.isConnected` and `server.isLoggedIn`, see [answer 4](#4-which-endpoint-shows-the-soulseek-login)), so pushes will work. Any other result has its own message: see [Troubleshooting](#troubleshooting).
5. **Production only:** the first time, Chrome shows a Local Network Access prompt by the address bar, asking to let the site reach apps on this device. Click **Allow**. Answer within 10 seconds: Mako stops waiting for slskd after 10 seconds, including while the prompt is open. If Save shows "slskd didn't answer" right after you allow it, click Save again. The permission is saved by then.

Dev shows no prompt.

### What the browser needs

- **Chrome 142 or later.** You only need to allow the one prompt in step 5. No flags or browser settings to change.
- **Nothing in slskd for CORS.** slskd allows every origin (see [answer 7](#7-cors)). Checked: preflights from both origins return `204` and allow the `x-api-key` and `content-type` headers.
- **Nothing for mixed content.** Chrome treats `http://localhost` as trustworthy, so the HTTPS site can call it.
- **Nothing on Vercel.** The production site sends no Content-Security-Policy or Permissions-Policy header that would block the call.

### Vercel preview deployments

Each preview URL (`mako-sync-git-<branch>-…vercel.app`) is a separate site to Chrome. On a preview, enter the config again and allow the prompt again. The production permission doesn't carry over.

### Where the config is kept

The config is saved in the browser's localStorage under `mako-sync:slskd-config`, separately for each site. It isn't saved in Supabase. The Options page has no Clear button. To clear it, open DevTools on the site and run this in the Console:

```js
localStorage.removeItem('mako-sync:slskd-config')
```

Then reload the page. Clearing the config doesn't reset Chrome's permission. To be asked again, reset it in site settings (lock icon → Site settings).

---

## Pushing tracks

The push is in the **Review Matches** tab, under **Confirmed Missing**. It only works on tracks you've confirmed as missing.

- **Push to slskd** starts one search for every track of the artists you select. A progress dialog shows each track as it goes, then the counts: Added, Skipped (already searched in slskd) and Failed.
- **Push album**, next to an album, starts one `Artist - Album` search. It shows a toast instead of the dialog.
- Both buttons need a saved API Endpoint and key. Until then, Push to slskd is disabled, Push album is hidden, and the section says "Configure slskd in Settings → Security to push tracks to slskd as searches."

### Search text

Each track becomes `Primary Artist - Title`, for example `Bicep - Glue`.

- **Primary artist only** (the default) keeps the artist before the first comma, then drops anything after `feat.` or `ft.`. Extra artists make Soulseek searches miss.
- **Full artist string** uses Spotify's whole artist field. Change it under Search Query Format on the Options page.
- Double quotes are removed. Nothing else is added: no bitrate or format, because `320 MP3` in the text made searches miss.

### What a push does

1. Reads every search slskd has saved, once (`GET /api/v0/searches`).
2. For each track, skips it if slskd already has the same search (see [the duplicate rule](#the-duplicate-rule)). Otherwise starts a search (`POST /api/v0/searches`), 100 ms after the previous one.
3. Each request waits up to 10 seconds for slskd.

If slskd rejects one search, that track counts as Failed and the push carries on. If slskd can't be reached at the start, nothing is pushed: the dialog closes and the toast says "Can't reach slskd at `http://localhost:5030`. Check that slskd is running and the API endpoint is right."

The push returns as soon as every search has started, but slskd runs only about two searches at a time (see [answer 3](#3-what-post-apiv0searches-does)). A push of 100 tracks takes several minutes to finish in slskd.

Mako saves nothing about a push. slskd's search list is the only record, which is why `retention.search` stays unset.

### The duplicate rule

`SlskdClientService.isSearchDuplicate()` skips a track when a saved search has the same text (compared without case or punctuation) and isn't retryable. `searchStateFlags()` splits the search's `state` on commas, because slskd sends state as flags such as `"Completed, TimedOut"` (see [answer 3](#3-what-post-apiv0searches-does)).

| Saved search's `state` | Push again? |
|------------------------|-------------|
| `Requested`, `Queued`, `InProgress` | No: it's waiting or running |
| `Completed, TimedOut`, `Completed, ResponseLimitReached`, `Completed, FileLimitReached` | No: it finished normally |
| `Completed, Cancelled`, `Completed, Errored` | Yes |
| Anything else, or no state | No, so an unclear search isn't pushed twice |

**A search that found nothing still blocks.** Most searches end with `TimedOut`, whether they found files or not, so Mako doesn't treat `TimedOut` or `fileCount === 0` as a reason to retry. Pushing the same artists again skips every track. To push a track again after its search found nothing, delete that search on slskd's Searches page first.

The tests in `src/services/__tests__/slskdClient.service.test.ts` use the real state strings. They cover adding, skipping, retrying and a failed search for `pushTracks()` and `pushAlbum()` against a mocked slskd. `src/components/__tests__/ConfirmedMissingSection.test.tsx` runs the section's tracks through the same push.

---

## Downloading pushed tracks

A push only starts searches. slskd downloads nothing by itself (see [answer 2](#2-is-there-a-wishlist)), so you download each track by hand in slskd.

1. In Review Matches, under **Confirmed Missing**, select artists and click **Push to slskd**. Or click **Push album** next to an album.
2. Open the slskd web UI (<http://localhost:5030>) and go to **Searches**. Each pushed track is a search named `Artist - Title`. Each pushed album is `Artist - Album`.
3. Wait for the searches to finish. slskd runs about two at a time and queues the rest.
4. Open a search and pick a result: MP3 320 or FLAC, with the right title and artist. Download the files from that user. They go to the downloads folder (`C:\Supercollection\99_TO_BE_CLEANED\Soulseek Downloads\complete`).
5. Leave the search in the list. Mako reads the list to skip tracks it has already pushed. Delete a search only when you want Mako to push that track again, for example after it found nothing.

What happens to the files after that (tagging and moving them into Supercrates) is Step 5 of the workflow, covered by the MediaMonkey 5 Cleanup project (MAK-204).

---

## How slskd behaves

What slskd 0.26.2 does with each part of the push, checked against its source. Code comments in `slskdClient.service.ts` and `src/types/slskd.ts` point to these answers by number.

### 1. Latest release

0.26.2 was the latest stable release when this was checked ([releases](https://github.com/slskd/slskd/releases/tag/0.26.2)). The Windows build is `slskd-0.26.2-win-x64.zip`.

### 2. Is there a wishlist?

**Not in the Soulseek sense.** slskd has no feature that re-runs saved searches in the background or downloads their results automatically. The words "wishlist" and "wish list" don't appear in the 0.24.0, 0.24.5 or 0.26.2 source (backend, web UI, docs or YAML), or in any release note from 0.19 to 0.26.2.

- The feature request is still open: [slskd #957](https://github.com/slskd/slskd/issues/957), from 2023. The maintainer plans automatic downloads under a "Guided Search" milestone.
- 0.26.0 added transfer batches, which "paves the way for features like a wishlist" ([PR #1720](https://github.com/slskd/slskd/pull/1720)).
- There is no "Auto-download wishlist results" option, in the Options page or in `slskd.yml`.
- **Confirmed live:** the running 0.26.2's Swagger definition lists 71 endpoints, and none of them is a wishlist endpoint.

**What Mako uses instead: saved searches.** Every search is saved to slskd's search list with its results ([SearchService.cs:237](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Search/SearchService.cs#L237)). By default it stays there indefinitely: `retention.search` defaults to unset ([Options.cs:1499](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Core/Options.cs#L1499)). Nothing runs it again. The only background work on searches is pruning when `retention.search` is set, and cleaning up searches left unfinished at startup ([Application.cs:1379](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Application.cs#L1379)).

### 3. What `POST /api/v0/searches` does

It starts **one search** on the Soulseek network and returns straight away. The search keeps running in the background ([SearchesController.cs:80](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Search/API/Controllers/SearchesController.cs#L80), [SearchService.cs:320](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Search/SearchService.cs#L320)).

- It ends 15 seconds after the last response (`searchTimeout`), or at 100 responses (`responseLimit`) or 10,000 files (`fileLimit`). The request body can override all three.
- It downloads nothing. You pick files from the results in the slskd web UI (Searches page) and download them there.
- Only one `POST` can be in progress at a time. A second one gets `429`. Mako sends them one after another, so this is fine.
- If slskd isn't connected to Soulseek, the call fails with `409 Conflict` (`InvalidOperationException`) or `500`.

**Search state is a set of flags.** `state` is the `[Flags]` enum `SearchStates` ([Soulseek.NET](https://github.com/jpdillingham/Soulseek.NET/blob/master/src/SearchStates.cs)): `Requested`, `InProgress`, `Completed`, `Cancelled`, `TimedOut`, `ResponseLimitReached`, `FileLimitReached`, `Errored`, `Queued`. slskd serialises it with `JsonStringEnumConverter` ([Program.cs:993](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Program.cs#L993)), so a finished search comes back as text like `"Completed, TimedOut"` or `"Completed, ResponseLimitReached"`, not `"Completed"`. Each search also has an `isComplete` boolean ([Search.cs:52](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Search/Types/Search.cs#L52)). **Confirmed live:** a test search for `Bicep Glue` came back from the `POST` as `InProgress`, and later as `Completed, ResponseLimitReached` in `GET /api/v0/searches`. It stopped at 250 responses, not at the documented default of 100.

**Confirmed live, batches:** slskd runs about two searches at a time. When 7 searches were sent 2 seconds apart, the rest came back as `Queued` and started as the first ones finished. Each search takes 15 seconds or more, so a batch of 100 tracks from Mako takes several minutes to finish in slskd, even though the push itself returns quickly.

### 4. Which endpoint shows the Soulseek login?

**`GET /api/v0/application`**, which Mako's connection test calls. It returns the application state, including `server.isConnected` and `server.isLoggedIn` ([ApplicationController.cs:82](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Core/API/Controllers/ApplicationController.cs#L82), [State.cs:91](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Core/State.cs#L91)). Any API key role can call it.

The other candidates don't work:

| Endpoint | Why not |
|----------|---------|
| `GET /api/v0/session` | Returns `200` with no body. It only checks that the key or token is valid ([SessionController.cs:80](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Core/API/Controllers/SessionController.cs#L80)). It has no `isLoggedIn`. |
| `GET /api/v0/server` | Returns the same server state, but the controller is limited to the `Administrator` role ([ServerController.cs:51](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Core/API/Controllers/ServerController.cs#L51)). |

**Confirmed live**, with the `ReadWrite` key `mako-sync`:

- `GET /api/v0/application` returned `server.isLoggedIn: true`, with `server.state` `"Connected, LoggedIn"`.
- `GET /api/v0/session` returned `200`.
- `GET /api/v0/server` returned `403`.
- A call without the key returned `401`.

### 5. Which endpoint queues a download?

Mako doesn't queue downloads. These are the endpoints it would use if it did ([option C](#why-the-push-only-starts-searches)). Both need only a valid key, with no role check:

- `POST /api/v0/transfers/downloads/{username}` with a body of `[{ "filename": "...", "size": 123 }]` ([TransfersController.cs:230](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Transfers/API/Controllers/TransfersController.cs#L230)).
- `POST /api/v0/transfers/downloads/batches` (new in 0.26.0) groups files and can carry the `searchId` they came from ([TransfersController.cs:304](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Transfers/API/Controllers/TransfersController.cs#L304)).

Results for choosing a file come from `GET /api/v0/searches/{id}/responses`. Each response has `username`, `hasFreeUploadSlot`, `queueLength` and `uploadSpeed`, plus `files` with `filename`, `size`, `extension`, `bitRate` and `length`.

### 6. API keys in `slskd.yml`

Keys go under `web.authentication.api_keys` ([config.md, API Keys](https://github.com/slskd/slskd/blob/0.26.2/docs/config.md#api-keys)), as in the [Config](#config) template.

- **`key`** must be 16 to 255 characters. `slskd --generate-secret <length>` makes one.
- **`role`** can be `ReadOnly` (the default), `ReadWrite` or `Administrator` ([Options.cs:2266](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Core/Options.cs#L2266)). In 0.26.2, roles are only checked on the application admin actions, debug, logs, options, server and relay endpoints. So even `ReadOnly` can create searches and queue downloads. Use `ReadWrite` anyway: Mako writes, and a later release could start enforcing roles on searches.
- **`cidr`** defaults to any address. Mako calls slskd from the browser on the same PC, so limit the key to loopback. slskd's docs warn against sending API keys over plain HTTP without a CIDR limit.
- The key is sent in the `X-API-Key` header.
- Swagger UI is at `/swagger`, and the definition at `/swagger/v0/swagger.json`. Both need `feature.swagger: true`, but no key.

### 7. CORS

**No setup needed, and none is possible.** slskd allows every origin, header and method, with credentials, and has no option for it ([Program.cs:838](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Program.cs#L838)).

### 8. Can `https://<vercel-app>` call `http://localhost:5030` in Chrome?

**Yes. Confirmed live** in Chrome 157 (MAK-213). See [Connecting Mako Sync](#connecting-mako-sync).

- **Local Network Access prompt: yes, once per site.** Since Chrome 142, a public HTTPS page calling a loopback address (`localhost`, `127.0.0.1`, `::1`) needs the `loopback-network` permission. Chrome asks the first time; the answer is saved per site and can be changed in site settings ([Chrome guide](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access), [Chrome blog](https://developer.chrome.com/blog/local-network-access)). If you deny it, `fetch` fails with a `TypeError`, which Mako's connection test reports as a failed connection, the same as slskd being off.
- **Dev server: no prompt.** A page served from `http://localhost:8080` calling localhost isn't checked.
- **Mixed content: not a problem.** Chrome doesn't block `http://localhost:5030` from the HTTPS site, so `SlskdClientService` doesn't need `targetAddressSpace: 'loopback'`.

---

## Why the push only starts searches

Decided on 14 November 2026 (MAK-215): saved searches are all that's needed.

| Option | Verdict |
|--------|---------|
| **A. Search-only push** | **Chosen.** Works with 0.26.2 as is. Each pushed track becomes a saved search in slskd. You open it on the Searches page and download from it. |
| B. slskd wishlist endpoint | Not possible: there is no wishlist endpoint. |
| C. Mako queues downloads | Possible with the endpoints in [answer 5](#5-which-endpoint-queues-a-download), but much bigger: polling searches, picking files, and the tab must stay open. Revisit if downloading by hand becomes the bottleneck, or when slskd ships Guided Search. |

---

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| "Can't reach slskd" on the Vercel site, but dev connects | The Chrome loopback prompt was denied. Reset it in site settings (lock icon → Site settings). |
| "Can't reach slskd" everywhere | slskd isn't running (`Get-Process slskd`), or the API Endpoint is wrong. |
| "Not logged in to Soulseek" | slskd is running, but isn't logged in to the Soulseek network, so every pushed search returns no results. The message includes slskd's `server.state`. Connect from the slskd web UI. If it won't stay logged in, check the Soulseek username and password in `slskd.yml`. |
| "Unexpected response" | Something answered at the API Endpoint, but not with slskd's JSON. Usually the endpoint points at the wrong port or app. |
| Push to slskd is disabled, and Confirmed Missing says "Configure slskd in Settings → Security" | No API Endpoint and key are saved on this site. Each site (dev, production, each preview) has its own config. See [Steps](#steps). |
| Push returns `409` | slskd isn't connected or logged in to Soulseek. |
| "Push failed" with "Can't reach slskd at …" | slskd isn't running, or on the Vercel site, Chrome's local network access prompt was denied. Nothing was pushed, and the progress dialog closes. |
| A push skips a track whose earlier search found nothing | Expected: a finished search blocks the track, even with no results (see [the duplicate rule](#the-duplicate-rule)). Delete the search on slskd's Searches page, then push again. |
| Push returns `429` | Another search request was still starting. Retry. |
| `401` on every call | Wrong API key, or the caller's IP is outside the key's `cidr`. |
| "API key rejected", and the slskd log says `Unknown API key beginning with: …` | The key in Mako's form is wrong, often an old one saved in the browser. Copy it again ([Steps](#steps), step 2) and click Save. |
| "slskd didn't answer" right after allowing the Chrome prompt | The prompt was open for more than 10 seconds. Click Save again. |
| `403` on `/api/v0/server` | Expected for non-Administrator keys. Use `/api/v0/application`. |
| `/swagger` returns 404 | `feature.swagger` is `false` by default. |
| slskd exits at startup, and the log says `global` and `groups` have moved | The config still uses the 0.24 layout. See [Migrating from the 0.24 backup](#migrating-from-the-024-backup). |
| The share shows 0 files after a scan that found files | The share path uses forward slashes. Use `C:\…`. See [Windows pitfalls](#windows-pitfalls). |
| Searches work, but every download fails with "Only absolute paths may be specified" | The `directories.downloads` or `directories.incomplete` path uses forward slashes. Use `C:\…`. See [Windows pitfalls](#windows-pitfalls). |
| slskd is still running after `Stop-ScheduledTask` | Expected: that only stops the `conhost` wrapper. Use `Stop-Process -Name slskd`. |

---

## History

- **February 2026:** the first slskd integration. Its plan assumed slskd had a wishlist that downloads automatically, which it never had. The plan is kept in [docs/archive/](../archive/).
- **November 2026, slskd Reintegration project:** checked what slskd 0.26.2 really does (MAK-211), installed and configured it on this PC (MAK-212), connected dev and production to it (MAK-213), made the connection test check the Soulseek login (MAK-214), fixed the duplicate check and changed "wishlist" to "searches" in the UI (MAK-215), tested the push end to end and closed the dialog when a push fails (MAK-216), and brought these docs up to date (MAK-217).
- **The duplicate check bug, fixed in MAK-215.** It used to block a search only when `state === 'InProgress' || state === 'Completed'`. Finished searches come back as flag strings such as `"Completed, TimedOut"`, so neither test matched: pushing the same tracks again started every search again, the "retry TimedOut, Cancelled and Errored" rule from MAK-16 never ran as written, and `Requested` or `Queued` searches weren't blocked. The unit tests had mocked bare `'Completed'` and `'TimedOut'` strings, so they passed.

---

**See also**: [slskd config docs](https://github.com/slskd/slskd/blob/0.26.2/docs/config.md), [Product Overview](../mako-sync-overview.md), [Architecture: slskd integration](../architecture-mako-sync.md#101-slskd-integration-one-way), [Production Deployment](production-deployment.md)
