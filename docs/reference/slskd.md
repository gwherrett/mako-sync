# slskd Reference

> **Reference**: What the current slskd release does with Mako Sync's push, and how to configure it for Mako.

**Status**: Active
**Last Updated**: 14 November 2026

---

## Overview

This doc records how slskd behaves today, checked against its source, so the slskd Reintegration project (MAK-211 to MAK-217) builds on facts, not on the February 2026 plan. Read it before you install slskd, change `src/services/slskdClient.service.ts`, or change the push in Review Matches.

**Version checked:** slskd **0.26.2** (released 23 October 2026, commit `e472ecd`). The wishlist question was also checked against 0.24.0 and 0.24.5. Answers come from reading the source and docs. Items marked **confirmed live** were checked against the slskd installed on this PC on 14 November 2026.

This PC's setup is recorded in [Install on Windows](#install-on-windows). How to connect Mako to it is in [Connecting Mako Sync](#connecting-mako-sync), and how to download what Mako pushes is in [Downloading pushed tracks](#downloading-pushed-tracks).

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

Port 5030 is the web UI and API. Port 50300 is for other Soulseek users to connect to you; don't open it in a browser.

---

## Answers

### 1. Latest release

0.26.2 is the latest stable release ([releases](https://github.com/slskd/slskd/releases/tag/0.26.2)). The Windows build is `slskd-0.26.2-win-x64.zip`.

### 2. Is there a wishlist?

**Not in the Soulseek sense.** slskd has no feature that re-runs saved searches in the background or downloads their results automatically. The words "wishlist" and "wish list" don't appear in the 0.24.0, 0.24.5 or 0.26.2 source (backend, web UI, docs or YAML), or in any release note from 0.19 to 0.26.2.

- The feature request is still open: [slskd #957](https://github.com/slskd/slskd/issues/957), from 2023. The maintainer plans automatic downloads under a "Guided Search" milestone.
- 0.26.0 added transfer batches, which "paves the way for features like a wishlist" ([PR #1720](https://github.com/slskd/slskd/pull/1720)).
- The old plan's "Options → Downloads → Auto-download wishlist results" setting doesn't exist.
- **Confirmed live:** the running 0.26.2's Swagger definition lists 71 endpoints, and none of them is a wishlist endpoint.

**What we use instead: saved searches.** Every search is saved to slskd's search list with its results ([SearchService.cs:237](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Search/SearchService.cs#L237)). By default it stays there indefinitely: `retention.search` defaults to unset ([Options.cs:1499](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Core/Options.cs#L1499)). Nothing runs it again. The only background work on searches is pruning when `retention.search` is set, and cleaning up searches left unfinished at startup ([Application.cs:1379](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Application.cs#L1379)). This is enough for Mako: see [Decision for Reint 3a](#decision-for-reint-3a).

### 3. What `POST /api/v0/searches` does

It starts **one search** on the Soulseek network and returns straight away. The search keeps running in the background ([SearchesController.cs:80](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Search/API/Controllers/SearchesController.cs#L80), [SearchService.cs:320](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Search/SearchService.cs#L320)).

- It ends 15 seconds after the last response (`searchTimeout`), or at 100 responses (`responseLimit`) or 10,000 files (`fileLimit`). The request body can override all three.
- It downloads nothing. You pick files from the results in the slskd web UI (Searches page) and download them there.
- Only one `POST` can be in progress at a time. A second one gets `429`. Mako sends them one after another, so this is fine.
- If slskd isn't connected to Soulseek, the call fails with `409 Conflict` (`InvalidOperationException`) or `500`.

**Search state is a set of flags.** `state` is the `[Flags]` enum `SearchStates` ([Soulseek.NET](https://github.com/jpdillingham/Soulseek.NET/blob/master/src/SearchStates.cs)): `Requested`, `InProgress`, `Completed`, `Cancelled`, `TimedOut`, `ResponseLimitReached`, `FileLimitReached`, `Errored`, `Queued`. slskd serialises it with `JsonStringEnumConverter` ([Program.cs:993](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Program.cs#L993)), so a finished search comes back as text like `"Completed, TimedOut"` or `"Completed, ResponseLimitReached"`, not `"Completed"`. Each search also has an `isComplete` boolean ([Search.cs:52](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Search/Types/Search.cs#L52)). See [Bug: duplicate check](#bug-the-duplicate-check-misses-finished-searches). **Confirmed live:** a test search for `Bicep Glue` came back from the `POST` as `InProgress`, and later as `Completed, ResponseLimitReached` in `GET /api/v0/searches`. It stopped at 250 responses, not at the documented default of 100.

**Confirmed live, batches:** slskd runs about two searches at a time. When 7 searches were sent 2 seconds apart, the rest came back as `Queued` and started as the first ones finished. Each search takes 15 seconds or more, so a batch of 100 tracks from Mako takes several minutes to finish in slskd, even though the push itself returns quickly.

### 4. Which endpoint shows the Soulseek login?

**`GET /api/v0/application`**, which Mako's connection test already calls. It returns the application state, including `server.isConnected` and `server.isLoggedIn` ([ApplicationController.cs:82](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Core/API/Controllers/ApplicationController.cs#L82), [State.cs:91](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Core/State.cs#L91)). Any API key role can call it.

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

Both need only a valid key, with no role check:

- `POST /api/v0/transfers/downloads/{username}` with a body of `[{ "filename": "...", "size": 123 }]` ([TransfersController.cs:230](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Transfers/API/Controllers/TransfersController.cs#L230)).
- `POST /api/v0/transfers/downloads/batches` (new in 0.26.0) groups files and can carry the `searchId` they came from ([TransfersController.cs:304](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Transfers/API/Controllers/TransfersController.cs#L304)).

Results for choosing a file come from `GET /api/v0/searches/{id}/responses`. Each response has `username`, `hasFreeUploadSlot`, `queueLength` and `uploadSpeed`, plus `files` with `filename`, `size`, `extension`, `bitRate` and `length`. Mako doesn't use any of this yet. It's only needed for option C.

### 6. API keys in `slskd.yml`

Keys go under `web.authentication.api_keys`, not `web.api_keys` as the old plan said ([config.md, API Keys](https://github.com/slskd/slskd/blob/0.26.2/docs/config.md#api-keys)):

```yaml
web:
  authentication:
    username: <change from slskd>
    password: <change from slskd>
    api_keys:
      mako-sync:
        key: <16 to 255 characters; generate with slskd --generate-secret>
        role: ReadWrite
        cidr: 127.0.0.1/32,::1/128
```

- **`role`** can be `ReadOnly` (the default), `ReadWrite` or `Administrator` ([Options.cs:2266](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Core/Options.cs#L2266)). In 0.26.2, roles are only checked on the application admin actions, debug, logs, options, server and relay endpoints. So even `ReadOnly` can create searches and queue downloads. Use `ReadWrite` anyway: Mako writes, and a later release could start enforcing roles on searches.
- **`cidr`** defaults to any address. Mako calls slskd from the browser on the same PC, so limit the key to loopback. slskd's docs warn against sending API keys over plain HTTP without a CIDR limit.
- The key is sent in the `X-API-Key` header.
- Swagger UI is at `/swagger`, and the definition at `/swagger/v0/swagger.json`. Both need `feature.swagger: true`, but no key.

### 7. CORS

**No setup needed, and none is possible.** slskd allows every origin, header and method, with credentials, and has no option for it ([Program.cs:838](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Program.cs#L838)). Drop the "allow CORS" step from Reint 1.

### 8. Can `https://<vercel-app>` call `http://localhost:5030` in Chrome?

**Yes. Confirmed live** in Chrome 157 (MAK-213). See [Connecting Mako Sync](#connecting-mako-sync).

- **Local Network Access prompt: yes, once per site.** Since Chrome 142, a public HTTPS page calling a loopback address (`localhost`, `127.0.0.1`, `::1`) needs the `loopback-network` permission. Chrome asks the first time; the answer is saved per site and can be changed in site settings ([Chrome guide](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access), [Chrome blog](https://developer.chrome.com/blog/local-network-access)). If you deny it, `fetch` fails with a `TypeError`, which Mako's connection test reports as a failed connection, the same as slskd being off.
- **Dev server: no prompt.** A page served from `http://localhost:8080` calling localhost isn't checked.
- **Mixed content: not a problem.** Chrome doesn't block `http://localhost:5030` from the HTTPS site, so `SlskdClientService` doesn't need `targetAddressSpace: 'loopback'`.

---

## Bug: the duplicate check misses finished searches

**Fixed in MAK-215 (Reint 3a).**

`SlskdClientService.isSearchDuplicate()` used to block a search only when `state === 'InProgress' || state === 'Completed'`. Finished searches come back as flag strings such as `"Completed, TimedOut"` (see [answer 3](#3-what-post-apiv0searches-does)), so neither test matched. In practice:

- Pushing the same tracks again started every search again, instead of skipping them.
- The "retry TimedOut, Cancelled and Errored" rule from MAK-16 never ran as written. Every finished search was retried.
- Searches that were still `Requested` or `Queued` weren't blocked either.

The unit tests mocked bare `'Completed'` and `'TimedOut'` strings, so they passed. The `SlskdSearchResponse.state` type had the same mistake.

### The rule now

`SlskdClientService.searchStateFlags()` splits `state` on commas. `isSearchDuplicate()` skips a track when any saved search has the same text (compared without case or punctuation) and isn't retryable:

| Saved search's `state` | Push again? |
|------------------------|-------------|
| `Requested`, `Queued`, `InProgress` | No: it's waiting or running |
| `Completed, TimedOut`, `Completed, ResponseLimitReached`, `Completed, FileLimitReached` | No: it finished normally |
| `Completed, Cancelled`, `Completed, Errored` | Yes |
| Anything else, or no state | No, so an unclear search isn't pushed twice |

**A search that found nothing still blocks.** Most searches end with `TimedOut`, whether they found files or not, so Mako doesn't treat `TimedOut` or `fileCount === 0` as a reason to retry. A repeat push then skips every track (Reint 3b, step 4). To push a track again after its search found nothing, delete that search on slskd's Searches page first.

The tests in `src/services/__tests__/slskdClient.service.test.ts` use the real strings. The track push (`SlskdClientService.pushTracks()`) and the album push (`pushAlbum()`) live in the service, so those tests cover adding, skipping, retrying and a failed search against a mocked slskd.

---

## Decision for Reint 3a

**Option A: keep the search-only push.** Decided on 14 November 2026: saved searches are all that's needed.

| Option | Verdict |
|--------|---------|
| **A. Search-only push** | **Chosen.** Works with 0.26.2 as is. Each pushed track becomes a saved search in slskd. You open it on the Searches page and download from it. |
| B. slskd wishlist endpoint | Not possible: there is no wishlist endpoint. |
| C. Mako queues downloads | Possible with the endpoints in [answer 5](#5-which-endpoint-queues-a-download), but much bigger: polling searches, picking files, and the tab must stay open. Revisit if downloading by hand becomes the bottleneck, or when slskd ships Guided Search. |

What Reint 3a did:

1. Fixed the duplicate check (above).
2. **Wording: searches.** Mako no longer says "wishlist". The Options page description, the Confirmed Missing hint, the push dialog and the toasts say Mako pushes tracks to slskd as searches. In code, `addToWishlist()` is now `startSearch()`.
3. Kept `retention.search` unset in `slskd.yml`. If searches were pruned, the duplicate check would forget them and they would be pushed again.

---

## Install on Windows

Installed on 14 November 2026 (MAK-212).

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

### Starting with Windows

slskd runs from a Task Scheduler task named `slskd`. It starts at logon for your account and runs `conhost.exe --headless "C:\Tools\slskd\slskd.exe"` from `C:\Tools\slskd`, so no console window opens. It has no time limit, and it restarts up to 3 times, 1 minute apart, if the task fails.

| To | Run |
|----|-----|
| Start | `Start-ScheduledTask slskd` |
| Stop | `Stop-Process -Name slskd`. `Stop-ScheduledTask` only stops the `conhost` wrapper and leaves `slskd.exe` running |
| Apply a config change | Stop, then start. slskd rereads most options while it runs, but share changes only take effect after the rescan at startup |

### Upgrading

1. Download the new `win-x64` zip. Check its SHA-256 against the digest on the GitHub release.
2. Stop slskd: `Stop-Process -Name slskd`.
3. Replace the contents of `C:\Tools\slskd`. The config and data in `%LOCALAPPDATA%\slskd` aren't touched.
4. Start it: `Start-ScheduledTask slskd`. Then check the newest file in `%LOCALAPPDATA%\slskd\logs` for config errors. slskd exits at startup when a config key has moved, as it did in 0.25.0.

### Config

The config was migrated from the April 2026 backup in `G:\My Drive\Dev-Config-Backup\slskd\slskd.yml`, which used the 0.24 layout. Don't restore that backup unchanged: 0.26.2 won't start with it. The changes were:

- **Moved `global` to `transfers` and `groups` to `transfers.groups`.** From 0.25.0, slskd refuses to start with the old keys ([0.25.0 release notes](https://github.com/slskd/slskd/releases/tag/0.25.0)).
- **Dropped five keys that never existed:** `searches.response_limit`, `downloads.maximum_downloads`, `downloads.retry_attempts`, `logger.level` and `logger.file`. They aren't options in 0.24.5 or 0.26.2, so slskd always ignored them. Download retries are now set with `transfers.download.retry.attempts: 3`.
- **Every Windows path written with backslashes** (share, downloads and incomplete), `.claude` and `.vscode` excluded, and a filter for any dot-folder (see below).
- **API key `mako-sync`:** the same key as before, now with `role: ReadWrite` and a loopback-only `cidr`.
- **Added `feature.swagger: true`.**
- **Added `web.ip_address: "127.0.0.1,::1"`.** By default slskd listens on every network interface, and the network here is marked Public. Mako runs in a browser on this PC, so nothing else needs access.

The full file, with secrets removed:

```yaml
soulseek:
  username: <redacted>
  password: <redacted>
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
    username: <redacted>
    password: <redacted>
    api_keys:
      mako-sync:
        key: <redacted>
        role: ReadWrite
        cidr: 127.0.0.1/32,::1/128

feature:
  swagger: true

# retention.search is deliberately left unset, so saved searches are kept
# and Mako's duplicate check can see them.
```

### Windows pitfalls

- **Use backslashes in every Windows path in `slskd.yml`.** Forward slashes broke two things on first start, in different ways:
  - **Downloads:** with `C:/…` download folders, searches work but every download fails straight away with "Only absolute paths may be specified (Parameter 'filename')". In the web UI, the queue-position request then returns `500`. Before writing a file, slskd checks `Path.GetFullPath(filename) != filename` ([FileService.cs:142](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Files/FileService.cs#L142)). On Windows, `GetFullPath` rewrites `/` as `\`, so the two never match.
  - **Share:** see the next point.
- **Share path in detail.** With `C:/Supercrates`, slskd 0.26.2 scanned 9,022 files but shared 0. It converts directory names to the share name (`Supercrates\…`) from paths that keep the configured prefix. File names come from `FileInfo.FullName`, which Windows rewrites with backslashes, so `ReplaceFirst("C:/Supercrates", …)` never matched ([ShareScanner.cs:340](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Shares/ShareScanner.cs#L340)). Browsing then shows no files, and search results can still return files under their full local path.
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
3. Open the Options page (`/security`). In **slskd Integration**, enter `http://localhost:5030` as the API Endpoint, and paste the key.
4. Click **Save**. It tests the connection, saves the config, and shows the **Connected** badge. **Test Connection** only tests: it doesn't save or change the badge. Both show the result under the buttons. "Connected" means slskd is running and logged in to Soulseek (`server.isConnected` and `server.isLoggedIn`, see [answer 4](#4-which-endpoint-shows-the-soulseek-login)), so pushes will work. Any other result has its own message: see [Troubleshooting](#troubleshooting).
5. **Production only:** the first time, Chrome shows a Local Network Access prompt by the address bar, asking to let the site reach apps on this device. Click **Allow**. Answer within 10 seconds: Mako stops waiting for slskd after 10 seconds, including while the prompt is open. If Save shows "slskd didn't answer" right after you allow it, click Save again. The permission is saved by then.

Dev shows no prompt.

### What a new machine needs

- **Chrome 142 or later.** You only need to allow the one prompt in step 5. No flags or browser settings to change.
- **Nothing in slskd for CORS.** slskd allows every origin (see [answer 7](#7-cors)). Checked: preflights from both origins return `204` and allow the `x-api-key` and `content-type` headers.
- **Nothing for mixed content.** Chrome treats `http://localhost` as trustworthy, so the HTTPS site can call it.
- **Nothing on Vercel.** The production site sends no Content-Security-Policy or Permissions-Policy header that would block the call.

### Vercel preview deployments

Each preview URL (`mako-sync-git-<branch>-…vercel.app`) is a separate site to Chrome. On a preview, enter the config again and allow the prompt again. The production permission doesn't carry over.

### Clearing the config

The config is saved in the browser's localStorage under `mako-sync:slskd-config`, separately for each site. The Options page has no Clear button. To clear it, open DevTools on the site and run this in the Console:

```js
localStorage.removeItem('mako-sync:slskd-config')
```

Then reload the page. Clearing the config doesn't reset Chrome's permission. To be asked again, reset it in site settings (lock icon → Site settings).

---

## Downloading pushed tracks

A push only starts searches. slskd downloads nothing by itself (see [answer 2](#2-is-there-a-wishlist)), so you download each track by hand in slskd.

1. In Review Matches, under **Confirmed Missing**, select artists and click **Push to slskd**. Or click **Push album** next to an album. The dialog shows how many searches were added, skipped or failed.
2. Open the slskd web UI (<http://localhost:5030>) and go to **Searches**. Each pushed track is a search named `Artist - Title`. Each pushed album is `Artist - Album`.
3. Wait for the searches to finish. slskd runs about two at a time and queues the rest, so a push of 100 tracks takes several minutes to finish (see [answer 3](#3-what-post-apiv0searches-does)).
4. Open a search and pick a result: MP3 320 or FLAC, with the right title and artist. Download the files from that user. They go to the downloads folder (`C:\Supercollection\99_TO_BE_CLEANED\Soulseek Downloads\complete`).
5. Leave the search in the list. Mako reads the list to skip tracks it has already pushed. Delete a search only when you want Mako to push that track again, for example after it found nothing.

---

## Changes to the other Reint issues

| Issue | Change |
|-------|--------|
| MAK-212 (Reint 1, install) | Done: see [Install on Windows](#install-on-windows). |
| MAK-213 (Reint 2a, connect) | Done: see [Connecting Mako Sync](#connecting-mako-sync). No code or slskd change was needed. |
| MAK-214 (Reint 2b, login check) | Done: the connection test reads `server.isConnected` and `server.isLoggedIn` from `GET /api/v0/application`, and each failure has its own message (see [Troubleshooting](#troubleshooting)). |
| MAK-215 (Reint 3a, push) | Done: option A. The duplicate check reads the state flags (see [The rule now](#the-rule-now)), and the UI says searches, not wishlist. |
| MAK-216 (Reint 3b, test) | Step 4 (push again, everything skipped) works with the MAK-215 fix. In step 6 (slskd stopped), the push fails with "Can't reach slskd at …" and the progress dialog closes. Step 7 is a manual download in slskd: see [Downloading pushed tracks](#downloading-pushed-tracks). |

---

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| "Can't reach slskd" on the Vercel site, but dev connects | The Chrome loopback prompt was denied. Reset it in site settings (lock icon → Site settings). |
| "Can't reach slskd" everywhere | slskd isn't running (`Get-Process slskd`), or the API Endpoint is wrong. |
| "Not logged in to Soulseek" | slskd is running, but isn't logged in to the Soulseek network, so every pushed search returns no results. The message includes slskd's `server.state`. Connect from the slskd web UI. If it won't stay logged in, check the Soulseek username and password in `slskd.yml`. |
| "Unexpected response" | Something answered at the API Endpoint, but not with slskd's JSON. Usually the endpoint points at the wrong port or app. |
| Push returns `409` | slskd isn't connected or logged in to Soulseek. |
| "Push failed" with "Can't reach slskd at …" | slskd isn't running, or on the Vercel site, Chrome's local network access prompt was denied. Nothing was pushed, and the progress dialog closes. |
| A push skips a track whose earlier search found nothing | Expected: a finished search blocks the track, even with no results (see [The rule now](#the-rule-now)). Delete the search on slskd's Searches page, then push again. |
| Push returns `429` | Another search request was still starting. Retry. |
| `401` on every call | Wrong API key, or the caller's IP is outside the key's `cidr`. |
| "API key rejected", and the slskd log says `Unknown API key beginning with: …` | The key in Mako's form is wrong, often an old one saved in the browser. Copy it again ([Steps](#steps), step 2) and click Save. |
| "slskd didn't answer" right after allowing the Chrome prompt | The prompt was open for more than 10 seconds. Click Save again. |
| `403` on `/api/v0/server` | Expected for non-Administrator keys. Use `/api/v0/application`. |
| `/swagger` returns 404 | `feature.swagger` is `false` by default. |
| slskd exits at startup, and the log says `global` and `groups` have moved | The config still uses the 0.24 layout. See [Config](#config). |
| The share shows 0 files after a scan that found files | The share path uses forward slashes. Use `C:\…`. See [Windows pitfalls](#windows-pitfalls). |
| Searches work, but every download fails with "Only absolute paths may be specified" | The `directories.downloads` or `directories.incomplete` path uses forward slashes. Use `C:\…`. See [Windows pitfalls](#windows-pitfalls). |
| slskd is still running after `Stop-ScheduledTask` | Expected: that only stops the `conhost` wrapper. Use `Stop-Process -Name slskd`. |

---

**See also**: [slskd config docs](https://github.com/slskd/slskd/blob/0.26.2/docs/config.md), [slskd integration plan (historical)](../plans/slskd-complete-implementation.md), [Production Deployment](production-deployment.md)
