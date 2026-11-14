# slskd Reference

> **Reference**: What the current slskd release does with Mako Sync's push, and how to configure it for Mako.

**Status**: Active
**Last Updated**: 14 November 2026

---

## Overview

This doc records how slskd behaves today, checked against its source, so the slskd Reintegration project (MAK-211 to MAK-217) builds on facts, not on the February 2026 plan. Read it before you install slskd, change `src/services/slskdClient.service.ts`, or change the push in Review Matches.

**Version checked:** slskd **0.26.2** (released 23 October 2026, commit `e472ecd`). The wishlist question was also checked against 0.24.0 and 0.24.5. Answers come from reading the source and docs. Items marked **confirm live** still need a check against a running slskd (Reint 1 and Reint 2a).

---

## Answers

### 1. Latest release

0.26.2 is the latest stable release ([releases](https://github.com/slskd/slskd/releases/tag/0.26.2)). The Windows build is `slskd-0.26.2-win-x64.zip`.

### 2. Is there a wishlist?

**Not in the Soulseek sense.** slskd has no feature that re-runs saved searches in the background or downloads their results automatically. The words "wishlist" and "wish list" don't appear in the 0.24.0, 0.24.5 or 0.26.2 source (backend, web UI, docs or YAML), or in any release note from 0.19 to 0.26.2.

- The feature request is still open: [slskd #957](https://github.com/slskd/slskd/issues/957), from 2023. The maintainer plans automatic downloads under a "Guided Search" milestone.
- 0.26.0 added transfer batches, which "paves the way for features like a wishlist" ([PR #1720](https://github.com/slskd/slskd/pull/1720)).
- The old plan's "Options → Downloads → Auto-download wishlist results" setting doesn't exist.

**What we use instead: saved searches.** Every search is saved to slskd's search list with its results ([SearchService.cs:237](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Search/SearchService.cs#L237)). By default it stays there indefinitely: `retention.search` defaults to unset ([Options.cs:1499](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Core/Options.cs#L1499)). Nothing runs it again. The only background work on searches is pruning when `retention.search` is set, and cleaning up searches left unfinished at startup ([Application.cs:1379](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Application.cs#L1379)). This is enough for Mako: see [Decision for Reint 3a](#decision-for-reint-3a).

### 3. What `POST /api/v0/searches` does

It starts **one search** on the Soulseek network and returns straight away. The search keeps running in the background ([SearchesController.cs:80](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Search/API/Controllers/SearchesController.cs#L80), [SearchService.cs:320](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Search/SearchService.cs#L320)).

- It ends 15 seconds after the last response (`searchTimeout`), or at 100 responses (`responseLimit`) or 10,000 files (`fileLimit`). The request body can override all three.
- It downloads nothing. You pick files from the results in the slskd web UI (Searches page) and download them there.
- Only one `POST` can be in progress at a time. A second one gets `429`. Mako sends them one after another, so this is fine.
- If slskd isn't connected to Soulseek, the call fails with `409 Conflict` (`InvalidOperationException`) or `500`.

**Search state is a set of flags.** `state` is the `[Flags]` enum `SearchStates` ([Soulseek.NET](https://github.com/jpdillingham/Soulseek.NET/blob/master/src/SearchStates.cs)): `Requested`, `InProgress`, `Completed`, `Cancelled`, `TimedOut`, `ResponseLimitReached`, `FileLimitReached`, `Errored`, `Queued`. slskd serialises it with `JsonStringEnumConverter` ([Program.cs:993](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Program.cs#L993)), so a finished search comes back as text like `"Completed, TimedOut"` or `"Completed, ResponseLimitReached"`, not `"Completed"`. Each search also has an `isComplete` boolean ([Search.cs:52](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Search/Types/Search.cs#L52)). See [Bug: duplicate check](#bug-the-duplicate-check-misses-finished-searches). **Confirm live:** run one search, then look at `GET /api/v0/searches`.

### 4. Which endpoint shows the Soulseek login?

**`GET /api/v0/application`**, which Mako's connection test already calls. It returns the application state, including `server.isConnected` and `server.isLoggedIn` ([ApplicationController.cs:82](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Core/API/Controllers/ApplicationController.cs#L82), [State.cs:91](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Core/State.cs#L91)). Any API key role can call it.

The other candidates don't work:

| Endpoint | Why not |
|----------|---------|
| `GET /api/v0/session` | Returns `200` with no body. It only checks that the key or token is valid ([SessionController.cs:80](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Core/API/Controllers/SessionController.cs#L80)). It has no `isLoggedIn`. |
| `GET /api/v0/server` | Returns the same server state, but the controller is limited to the `Administrator` role ([ServerController.cs:51](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Core/API/Controllers/ServerController.cs#L51)). |

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

### 7. CORS

**No setup needed, and none is possible.** slskd allows every origin, header and method, with credentials, and has no option for it ([Program.cs:838](https://github.com/slskd/slskd/blob/0.26.2/src/slskd/Program.cs#L838)). Drop the "allow CORS" step from Reint 1.

### 8. Can `https://<vercel-app>` call `http://localhost:5030` in Chrome?

- **Local Network Access prompt: yes, once per site.** Since Chrome 142, a public HTTPS page calling a loopback address (`localhost`, `127.0.0.1`, `::1`) needs the `loopback-network` permission. Chrome asks the first time; the answer is saved per site and can be changed in site settings ([Chrome guide](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access), [Chrome blog](https://developer.chrome.com/blog/local-network-access)). If you deny it, `fetch` fails with a `TypeError`, which Mako's connection test reports as a failed connection, the same as slskd being off.
- **Dev server: no prompt.** A page served from `http://localhost:8080` calling localhost isn't checked.
- **Mixed content: unknown, confirm live.** Chrome's docs don't say whether `http://localhost` from an HTTPS page counts as mixed content. They document `fetch(url, { targetAddressSpace: 'loopback' })` as the way to exempt an `https://` → `http://` loopback request. If the production check in Reint 2a fails with a mixed-content error, add that option in `SlskdClientService`.

---

## Bug: the duplicate check misses finished searches

`SlskdClientService.isSearchDuplicate()` blocks a search only when `state === 'InProgress' || state === 'Completed'`. Finished searches come back as flag strings such as `"Completed, TimedOut"` (see [answer 3](#3-what-post-apiv0searches-does)), so neither test matches. In practice:

- Pushing the same tracks again starts every search again, instead of skipping them.
- The "retry TimedOut, Cancelled and Errored" rule from MAK-16 never runs as written. Every finished search is retried.
- Searches that are still `Requested` or `Queued` aren't blocked either.

The unit tests mock bare `'Completed'` and `'TimedOut'` strings (`src/services/__tests__/slskdClient.service.test.ts`), so they pass. The `SlskdSearchResponse.state` type in `src/types/slskd.ts` has the same mistake.

**Fix (Reint 3a):** split `state` on `", "` and test the flags, or use `isComplete`. Block a search that isn't complete yet, or that completed without `Cancelled` or `Errored`. Allow a retry for `Cancelled` and `Errored`. Decide whether `TimedOut` with zero responses counts as a retry: it's the normal way a search ends, so `fileCount === 0` is a better signal. Update the tests to use the real strings.

---

## Decision for Reint 3a

**Option A: keep the search-only push.** Decided on 14 November 2026: saved searches are all that's needed.

| Option | Verdict |
|--------|---------|
| **A. Search-only push** | **Chosen.** Works with 0.26.2 as is. Each pushed track becomes a saved search in slskd. You open it on the Searches page and download from it. |
| B. slskd wishlist endpoint | Not possible: there is no wishlist endpoint. |
| C. Mako queues downloads | Possible with the endpoints in [answer 5](#5-which-endpoint-queues-a-download), but much bigger: polling searches, picking files, and the tab must stay open. Revisit if downloading by hand becomes the bottleneck, or when slskd ships Guided Search. |

Reint 3a still needs to:

1. Fix the duplicate check (above).
2. Decide on the wording. Mako's UI says "wishlist". slskd calls them searches. Either keep "wishlist" for the Mako-side idea, or rename the button, toasts and Options description to "searches".
3. Leave `retention.search` unset in `slskd.yml`. If searches were pruned, the duplicate check would forget them and they would be pushed again.

---

## Changes to the other Reint issues

| Issue | Change |
|-------|--------|
| MAK-212 (Reint 1, install) | Drop the CORS step. Put keys under `web.authentication.api_keys` with `role` and `cidr` ([answer 6](#6-api-keys-in-slskdyml)). Add `feature: swagger: true` (it's off by default) if you want `/swagger`. Leave `retention.search` unset. |
| MAK-213 (Reint 2a, connect) | Expect the Chrome loopback prompt on the Vercel site, and none on dev. Watch for a mixed-content error ([answer 8](#8-can-httpsvercel-app-call-httplocalhost5030-in-chrome)). |
| MAK-214 (Reint 2b, login check) | Read `server.isLoggedIn` from `GET /api/v0/application`. Don't use `/session` or `/server`. |
| MAK-215 (Reint 3a, push) | Option A, plus the duplicate-check fix. |
| MAK-216 (Reint 3b, test) | Step 4 (push again, everything skipped) fails until the duplicate check is fixed. Step 7 is a manual download in slskd. |

---

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| Test Connection fails from the Vercel site but works on dev | The Chrome loopback prompt was denied. Reset it in site settings (lock icon → Site settings). |
| Push returns `409` | slskd isn't connected or logged in to Soulseek. |
| Push returns `429` | Another search request was still starting. Retry. |
| `401` on every call | Wrong API key, or the caller's IP is outside the key's `cidr`. |
| `403` on `/api/v0/server` | Expected for non-Administrator keys. Use `/api/v0/application`. |
| `/swagger` returns 404 | `feature.swagger` is `false` by default. |

---

**See also**: [slskd config docs](https://github.com/slskd/slskd/blob/0.26.2/docs/config.md), [slskd integration plan (historical)](../plans/slskd-complete-implementation.md), [Production Deployment](production-deployment.md)
