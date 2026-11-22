# MediaMonkey 5 Reference

> **Reference**: What MediaMonkey 5 can do for the MediaMonkey 5 Download Cleanup project, checked against the installed app and its add-on source.

**Status**: Complete (add-on API answered; all in-app checks done)
**Last Updated**: 21 November 2026

---

## Overview

The MediaMonkey 5 Download Cleanup project (MAK-193 to MAK-204) uses MediaMonkey to clean and organize fresh slskd downloads. This doc records which MediaMonkey features that plan can rely on. Read it before you build or change the Mako Clean add-on, or the monitored folder and Auto-Organize setup.

**Version:** the installed app is **MediaMonkey 2024.2.2.3222** (`C:\Program Files (x86)\MediaMonkey\MediaMonkey.exe`). MediaMonkey 2024 is the release after MediaMonkey 5 and runs the same add-on framework, so "MM5" in the project issues means this app.

**How the answers were found:**

* **Add-on API:** from the JavaScript and TypeScript that ships with the app, in `C:\Program Files (x86)\MediaMonkey\typescript\src\` and `C:\Program Files (x86)\MediaMonkey\dialogs\`. MediaMonkey's own UI is built on the same API an add-on uses, so its code shows exactly which calls exist. The native objects (`Track`, `app.filesystem`, ...) have no published type file, so a call only counts as confirmed if the app's own code uses it. File and line references below are for build 3222.
* **Add-on structure:** from the first-party add-ons in [ventismedia/mediamonkey-addons](https://github.com/ventismedia/mediamonkey-addons) and the [Getting Started (Addons)](https://www.mediamonkey.com/wiki/Getting_Started_(Addons)) wiki page.
* **Current settings:** from `%APPDATA%\MediaMonkey5\MediaMonkey.ini` on this PC.

The public API reference at <https://www.mediamonkey.com/docs/api/> no longer has per-class pages (`classes/Track.html` returns 404), so nothing here links to it.

---

## Summary for the project

| Project need | Answer | Affects |
|------|------|------|
| Add-on writes Genre, Grouping, Album Artist | **Yes.** Fields `genre`, `groupDesc`, `albumArtist`, saved with `commitAsync()` | MAK-197, MAK-199, MAK-200 |
| The write reaches the file | **Yes, when "Update tags when editing properties" is on.** It's on here | MAK-197 |
| Add-on runs when new tracks arrive | **Yes.** A monitored-folder scan fires `trackAdded`, and the track's tags are already read (check 7) | MAK-201 |
| Add-on reads the exported genre map | **Yes.** `app.filesystem.loadTextFromFileAsync(path)` | MAK-195, MAK-199 |
| Add-on removes one ID3 comment frame | **No.** Only the single Comment field, or a whole ID3v1 or ID3v2 tag | `fix_comments.py` stays in Python |
| Packaging and install | `.mmip` (a renamed ZIP), installed from **Tools > Addons > Add** | MAK-197 |
| Auto-Organize by Grouping | **Yes.** Grouping is an Auto-Organize mask field, confirmed in the app (check 6) | MAK-201 |
| Auto-Organize skips a blank Grouping | **Yes,** with an auto-playlist "Grouping is not empty" as the rule's criteria (check 6) | MAK-201 |
| Auto-Organize runs by itself | **Gold only** ("Automatically organize files (during scans or edits)"). This install is Gold and offers it (check 6) | MAK-201 |
| Monitored folders | **Work here** with no Gold prompt (check 8) | MAK-201 |
| Edition | **Gold**, build 2024.2.2.3222 | MAK-201, MAK-203 |
| M4A Grouping set in MM reaches Mako | **Yes.** Mako's Local scan shows it as the SuperGenre | MAK-202 |
| Grouping edit in MM keeps Serato BPM and key | **Yes** | MAK-197, MAK-199 |
| MM sees tag edits made by other tools | **Only after a rescan** | MAK-201 |
| Dependabot PR #144 (music-metadata 12.5) | Mako's Local scan shows the same genre and Grouping as production for MP3, FLAC and M4A (check 9) | MAK-230 |

---

## Add-on API

### Can an add-on read and write Genre, Grouping and Album Artist on the selected tracks? Does a write reach the file straight away?

**Yes, to both, if "Update tags when editing properties" is on.**

* **Getting the selected tracks:** `uitools.getSelectedTracklist()`, then `await tracklist.whenLoaded()`. Loop with `listAsyncForEach(tracklist, async (track, next) => { ...; next(); })`. Source: [copy-and-swap-fields/actions_add.js](https://github.com/ventismedia/mediamonkey-addons/blob/master/copy-and-swap-fields/actions_add.js) (`copyFieldToField`).
* **Field names on a track:**

  | Tag | Track property | Source |
  |-----|----------------|--------|
  | Genre | `track.genre` | `typescript\src\controls\trackListView.ts:327-341` |
  | Grouping | `track.groupDesc` (not `grouping`) | `typescript\src\controls\trackListView.ts:1294-1306`, `typescript\src\templateFormats.ts:62` |
  | Album Artist | `track.albumArtist` | `copy-and-swap-fields/actions_add.js` (`supportedFields`) |
  | Comment | `await track.getCommentAsync()` / `await track.setCommentAsync(text)` | `typescript\src\controls\trackListView.ts:1081-1099` |

* **Several genres on one track:** `track.genre` holds them as one string. The app shows it with `utils.multiString2VisualString(track.genre)`, which uses the separator `"; "` (`MultiStringSeparator=; ` in `MediaMonkey.ini`). In the file, MM writes them as separate TCON values, not one string (check 2).
* **Saving:** set the properties, then call `commitAsync()` on the track or on the whole list. Source: `copy-and-swap-fields/actions_add.js` calls `tracklist.commitAsync()` after the loop, and MediaMonkey's own rating control calls `itm.commitAsync()` (`typescript\src\templates.ts:942-952`). The forms seen in the app's code are:
  * `commitAsync()`: the normal save.
  * `commitAsync({ forceSaveToDB: true })`: also adds a track that isn't in the library yet (`templates.ts:942`).
  * `commitAsync({ tagModified: true })`: what the Properties dialog sends after a tag edit (`dialogs\dlgTrackProperties.js:696-698`).
* **Does it reach the file?** It depends on **Tools > Options > Library > Tags & Playlists > "Update tags when editing properties"** (`Options.StoreID3AfterEdit`; `dialogs\dlgOptions\pnl_TagsAndPlaylists.html:33`, `pnl_TagsAndPlaylists.js:64`). It's **on** on this PC (`StoreID3AfterEdit=1`). With it off, edits stay in the library database until you run **Synchronize tags** (`app.trackOperation.updateTags(tracks, true)`, `typescript\src\actions.ts:7940-7956`).
* **Other settings that affect the write**, as set here: MP3 tags are written as ID3v2.3 (`StoreID3v2Version=3`), and "Modify timestamp when updating tags" is on (`ModifyTimeOnTag=1`).

**Caveat:** whether `commitAsync()` writes M4A and FLAC tags as well as MP3 isn't visible in the JavaScript. Check 3 shows that an M4A Grouping edit made in MM's own UI reaches the file. A write from an add-on's `commitAsync()` hasn't been tested on M4A or FLAC.

### Can an add-on run when a monitored folder adds tracks, or only from a menu action?

**Both. A monitored-folder scan fires `trackAdded`, with the tags already read (check 7).**

* **Menu action:** define it in `actions_add.js` and push it into a menu, e.g. `window._menuItems.editTags.action.submenu`. Source: [copy-and-swap-fields/actions_add.js](https://github.com/ventismedia/mediamonkey-addons/blob/master/copy-and-swap-fields/actions_add.js). The wiki says custom actions must be defined in `actions_add.js` ([Getting Started (Addons)](https://www.mediamonkey.com/wiki/Getting_Started_(Addons))).
* **On startup:** an `init.js` at the add-on root runs at startup. Wrap the code in `window.whenReady(() => { ... })`. Source: [output-now-playing-to-file/init.ts](https://github.com/ventismedia/mediamonkey-addons/blob/master/output-now-playing-to-file/init.ts).
* **On new tracks:** `app.listen(app, 'trackAdded', (track) => { ... })`. MediaMonkey's own device sync uses it, with the comment "a new track was added to library right now" (`typescript\src\helpers\mediaSync.ts:2949-2953`). A sibling event `app.listen(app, 'trackModified', (track) => ...)` fires when a track changes (`mediaSync.ts:2943-2947`).
* **Confirmed in the app (check 7):** a monitored-folder scan of one new MP3 raised `trackAdded`, and `track.genre` was already filled in. The event is raised in native code, which doesn't ship, so this was the only way to find out. Not tested: a scan that adds many tracks at once. The test add-on overwrites its file on each event, so it was run with one track.
* **Caution for MAK-201:** a handler that edits and commits the track will itself raise `trackModified`, and Auto-Organize can also run "during scans or edits". The add-on must not react to its own writes.

### Can an add-on read a local file, such as the exported genre map?

**Yes.** `app.filesystem.loadTextFromFileAsync(path)` returns a promise of the file's text. MediaMonkey's filter editor uses it to load a preset file the user picked (`typescript\src\controls\filterEditor.ts:176-182`).

Related calls that the app's own code uses:

* `app.filesystem.fileExistsAsync(path)`: check the map file is there before reading it.
* `app.filesystem.saveTextToFileAsync(path, text)`: write a text file, e.g. a preview report. Source: [output-now-playing-to-file/init.ts](https://github.com/ventismedia/mediamonkey-addons/blob/master/output-now-playing-to-file/init.ts).
* `app.utils.dialogOpenFile(dir, ext, filter, title)`: let the user pick the file (`filterEditor.ts:177`).
* `app.filesystem.getUserFolder()` and `app.filesystem.getDataFolder()`: base folders for a default path (`typescript\src\viewHandlers.ts:5336`).
* `app.getValue(key, default)`: read a saved add-on setting, such as the map path. Source: `output-now-playing-to-file/init.ts`.

### Can an add-on remove a single ID3 comment frame?

**No (as expected).** The API works on fields, not frames:

* **Comment:** one value per track, through `getCommentAsync()` and `setCommentAsync(text)` (`trackListView.ts:1081-1099`). There's no way to pick a comment by its descriptor or language, as `fix_comments.py` does.
* **Extended tags:** `track.getExtendedTagsAsync()` and `track.setExtendedTagsAsync(json)` read and write the custom title/value pairs on the Properties dialog's Custom tab (`dialogs\dlgTrackProperties\tabCustom.js:128-148`). They don't expose comment frames.
* **Whole tags:** `app.trackOperation.stripID3TagsFromFiles(tracks, 'ID3v1' | 'ID3v2')` removes the entire ID3v1 or ID3v2 tag (`typescript\src\actions.ts:1629-1644`, `7956`). That's far too broad for this job.

So `fix_comments.py` stays in Python, as the project assumed.

### How are add-ons packaged and installed?

* **Package:** a `.mmip` file, which is a ZIP renamed. The files go at the root of the ZIP, not in a subfolder ([Getting Started (Addons)](https://www.mediamonkey.com/wiki/Getting_Started_(Addons))).
* **`info.json`** (required, at the root): `title`, `id`, `description`, `version` (three numbers, e.g. `1.0.0`). Optional fields include `type` (e.g. `"metadata"`), `author`, `icon`, `minAppVersion`, `config` and `updateURL`. Example: [copy-and-swap-fields/info.json](https://github.com/ventismedia/mediamonkey-addons/blob/master/copy-and-swap-fields/info.json).
* **Code files:** `actions_add.js` (actions and menus), `init.js` (runs at startup), and `<name>_add.js` files that are appended to the app's own file of that name. Dialogs go in `dialogs/` as an `.html` and `.js` pair. Example: [split-multi-value-fields](https://github.com/ventismedia/mediamonkey-addons/tree/master/split-multi-value-fields).
* **Settings page:** `config.html` and `config.js` at the root, with `load` and `save` functions. Example: [output-now-playing-to-file](https://github.com/ventismedia/mediamonkey-addons/tree/master/output-now-playing-to-file).
* **Build:** Ventis packs its add-ons with [pack-mmip](https://github.com/JL102/pack-mmip) ([Makefile](https://github.com/ventismedia/mediamonkey-addons/blob/master/Makefile)). Zipping the folder by hand also works.
* **Install:** **Tools > Addons > Add**, pick the `.mmip`, then reload the window when asked. Installed add-ons live in `%APPDATA%\MediaMonkey5\Scripts\<id>\`.
* **TypeScript:** optional. The first-party add-ons mix `.js` and `.ts`, and the app ships its own sources in `C:\Program Files (x86)\MediaMonkey\typescript\` for reference.

---

## In MediaMonkey

These were run on **copies** of files, in a test folder outside Supercrates. Some answers came from the app's settings and code first and were then confirmed in the app. The numbers match the checklist on MAK-193.

| # | Question | Answer | Status |
|---|----------|--------|--------|
| 1 | Edition (Gold or free) and build number | **Gold**, build **2024.2.2.3222** (build from `MediaMonkey.exe`, edition from **Help > About**) | Done |
| 2 | How MM stores several genres on one track | **Separate values.** Setting Genre to `Soul; Funk` in MM and saving wrote an ID3v2.4 TCON frame holding `['Soul', 'Funk']`, not the single string `Soul; Funk`. The `"; "` separator is only how MM shows them. Tested on a copy of `34 Proud Mary.mp3`, 16 November 2026. Not tested: ID3v2.3 files, and whether the copy was already ID3v2.4 before the edit (`StoreID3v2Version=3` says new tags are v2.3) | Done |
| 3 | M4A: set Grouping in MM, then run Mako's Local scan. Does `super_genre` show the value? | **Yes.** Grouping `House` set in MM shows as the SuperGenre in Mako's Local tab | Done |
| 4 | Serato: change Grouping in MM on an analysed MP3 copy. Are BPM and key still there in Serato? | **Yes.** BPM and key are kept | Done |
| 5 | Mako Step 5 on a file MM knows. Does MM show the new Grouping without a manual rescan? | **No.** MM shows the old Grouping until **File > Add/Rescan files to the Library**, then the new one. A rescan re-reads the tags of changed files (`RescanDBInfo=1`, `RescanModifFilesOnly=1`). No folders are monitored yet (`FolderCount=0`) | Done |
| 6a | Auto-Organize: can the destination use Grouping? | **Yes.** Grouping is one of the mask fields (`typescript\src\masks.ts:30`, `107`). Pick it with the mask editor's field list, e.g. `Supercrates\<Grouping>\<Artist> - <Title>`. The mask worked in the app | Done |
| 6b | Can it run by itself? | **Only with Gold**: "Automatically organize files (during scans or edits)" (`dialogs\dlgOptions\pnl_AutoOrganize.js:14-18`). This install is Gold and offers the option. Off here (`DoInBackground=0`). It can also be run by hand on selected tracks with **Tools > Organize files** (Ctrl+R) | Done |
| 6c | Can it skip tracks with a blank Grouping? | **Yes.** A rule's criteria are collections, genres or playlists, not a free filter (`dialogs\dlgAutoOrganizeRule.js:47-80`). An auto-playlist "Grouping is not empty" as the criteria skipped the blank-Grouping tracks. Creating or editing collections needs Gold (`dialogs\dlgOptions\pnl_MediaTree.js:225-260`), which this install has | Done |
| 7 | Does a monitored-folder scan fire `trackAdded`, with the tags already read? | **Yes.** With the test add-on below, `mm-trackadded-test.txt` appeared with the genre filled in. Tested with one new MP3 | Done |
| 8a | Gold: monitored folders | No Gold check in the monitored-folders code (`typescript\src\controls\monitoredFoldersView.ts`). Schedules offered: One time, Manual, At startup, Continuously. Ran with no Gold prompt | Done |
| 8b | Gold: Auto-Organize | Running it by itself is Gold (6b). **Tools > Organize files** by hand ran with no Gold prompt | Done |
| 8c | Gold: web lookup | Looking up tracks during a scan is Gold (`typescript\src\uitools.ts:3018`). Auto-tag from web is coded to ask for Gold after the first batch (`dialogs\dlgAutotag.js:141-143`); on this Gold install it ran with no prompt | Done |
| 8d | Gold: duplicate finding | The duplicate-content view (**List (by Content)**, `app.db.runDuplicateAnalyze()`) has no Gold check (`typescript\src\viewHandlers.ts:484-515`). Ran with no Gold prompt | Done |
| 9 | Mako's Local scan on the Dependabot PR #144 preview (music-metadata 12.5) vs production. Do genre and Grouping match for MP3, FLAC and M4A? | **Yes.** Every file matched (for MAK-230) | Done |

This install is Gold, so check 8 shows only that none of these features asked for Gold here. It doesn't show which ones a Standard install would lock; for that, the code notes in 8a–8d are the best guide.

### How to run the checks

1. **Edition:** **Help > About**. Note Gold or Standard.
2. **Multi-genre storage:** on a copy of an MP3, set Genre to `House; Deep House` in MM and save. Read TCON with mutagen:

   ```bash
   python -c "import sys; from mutagen.id3 import ID3; t = ID3(sys.argv[1]); print(t.version, [f.text for f in t.getall('TCON')])" "<file>"
   ```

   Two values look like `[['House', 'Deep House']]`; one string looks like `[['House; Deep House']]`. Don't use `mp3_metadata_demo.py detailed` for this: it prints two values as `House Deep House`, which looks like one string.
3. **M4A Grouping:** on a copy of an M4A, set Grouping to a SuperGenre (e.g. `House`) in MM and save. Run Mako's Local scan on that folder. In the Local tab, check the track's SuperGenre.
4. **Serato:** copy an MP3 that Serato has analysed (it has BPM and key). Set Grouping on the copy in MM and save. Add the copy to Serato. Check BPM and key.
5. **Edits from other tools:** add a folder of copies to MM's library. Run Mako Step 5 on the same folder. Without rescanning, look at the Grouping column in MM. Then rescan the folder (**File > Add/Rescan files to the Library**) and look again.
6. **Auto-Organize:** in **Tools > Options > Library > Auto-Organize**, add a rule with a mask that uses Grouping. Try an auto-playlist ("Grouping is not empty") as the criteria. Select the test tracks and run **Tools > Organize files** (Ctrl+R). Note whether "Automatically organize files (during scans or edits)" is offered.
7. **`trackAdded` on a monitored-folder scan:** this answers the API question above. With a test add-on whose `init.js` is:

   ```javascript
   window.whenReady(() => {
       app.listen(app, 'trackAdded', (track) => {
           app.filesystem.saveTextToFileAsync(
               app.filesystem.getUserFolder() + 'mm-trackadded-test.txt',
               track.path + ' | genre=' + track.genre + ' | grouping=' + track.groupDesc);
       });
   });
   ```

   add a test folder as a monitored folder, copy one new MP3 into it, and run the scan. If the text file appears with the track's genre filled in, the event fires and the tags are read by then. (The file is overwritten on each event, so test with one track.) Remove the add-on afterwards.
8. **Gold features:** while you're in the app, note which of these ask for Gold: monitored folders, **Tools > Organize files**, auto-tag from web after the first batch, and the **List (by Content)** duplicate view.
9. **Dependabot preview scan (MAK-230):** make sure the test folder has at least one MP3, one FLAC and one M4A copy. Run Mako's Local scan on it on the PR #144 Vercel preview, then on production. Compare the genre and Grouping columns for every file.

---

## Mako Clean add-on

Built in MAK-197, MAK-199, MAK-200 and MAK-202. The source is in `mediamonkey/mako-clean/`.

**Rule** the add-on runs on each selected track:

* **Grouping from the SuperGenre map** (MAK-199). It splits Genre on MM's multi-value separator and maps it with `mapToSuperGenre`, the same function Mako's Step 5 uses (`src/utils/superGenreMapping.ts`). If Grouping already equals the SuperGenre, nothing changes. A different existing Grouping shows as **Overwrite**. Tracks with no genre or an unmapped genre are listed with their genres.

**Built but not turned on:** "Mixed by" removed from Album Artist (MAK-200, `src/core/rules/albumArtistMixedBy.ts`). It's the same rule as `python/fix_album_artist.py`, with the result trimmed. Album Artist is left alone until this is decided. A scan of `C:\Supercrates` on 21 November 2026 (8,979 MP3, FLAC and M4A files) found 12 such tracks. All 12 are MP3s from one DJ mix album in `Bass\UK Garage`: Album Artist "Mixed by DJ Ed Case", album "Sound of the Pirates 2". No other mix credits (such as "Mix by", "Compiled by" or "Mixed By:") were found in Album Artist or Artist. To turn the rule on, add it after `superGenreGrouping` in `src/core/rules/index.ts`.

M4A gets Grouping the same way as MP3 and FLAC, because MM writes the tag (MAK-202).

### Install

1. Run `npm run mm:package`. It builds `mediamonkey/dist/mako-clean.mmip`.
2. In MM, go to **Tools > Addons > Add**, pick the `.mmip` and reload when asked.
3. On Mako's **Genre Tools** page, click **Download for MediaMonkey**. This saves `mako-genre-map.json`.
4. In **Tools > Addons**, open the settings for **Mako Clean** and set **Genre map file** to that file.

Download the map again after you change mappings in Mako. The add-on reads the file on every run, and the preview shows when the map was exported.

### Use

1. Select tracks and choose **Edit Tags > Mako: Clean selected tracks...**.
2. The preview lists every change: track, file, field, current value, new value, and whether it overwrites a value. Tracks no rule changed are listed with the reason. Nothing is written yet.
3. Click **Apply**. The add-on runs the rules again on the tags as they are at that moment, then saves each changed track with `commitAsync()`. Tracks with no change aren't rewritten. A summary shows how many tracks were changed, unchanged, skipped and failed, with the reasons.

**Not done by the add-on:** Album Artist (see above), comment frames (`fix_comments.py` stays in Python) and running by itself when tracks arrive (MAK-201).

---

## What this means for the Phase 2 and 3 issues

A first read, to help with the human review step. You decide each one.

* **MAK-197 (add-on with preview and apply):** possible as planned. Menu action on the selected tracks, `commitAsync()` to save. A Grouping edit in MM keeps Serato's BPM and key (check 4).
* **MAK-199 (Grouping from the map):** possible. Write `track.groupDesc`. Read the map with `loadTextFromFileAsync`. Split `track.genre` on `"; "` before mapping. MM writes several genres as separate TCON values (check 2).
* **MAK-200 ("Mixed by" from Album Artist):** possible. Write `track.albumArtist`.
* **MAK-201 (monitored folder and Auto-Organize):** possible as planned. This install is Gold and offers "organize during scans or edits" (checks 1 and 6). The Grouping mask works, and an auto-playlist "Grouping is not empty" skips untagged tracks (check 6). A monitored-folder scan fires `trackAdded` with the tags already read, so the add-on can run on new tracks (check 7); it must ignore its own writes (see the caution above). MM doesn't see tag edits from other tools until a rescan (check 5). If Mako Step 5 writes Grouping, rescan before MM organizes on it.
* **MAK-202 (M4A Grouping):** a Grouping set in MM's UI on an M4A reaches Mako as the SuperGenre (check 3). A write from the add-on is untested on M4A.
* **MAK-198 (duplicates):** the duplicate-content view ran with no Gold prompt (check 8d), and its code has no Gold check.
* **MAK-203 (web lookup):** looking up during a scan needs Gold, which this install has (check 1). Auto-tag from web ran past the first batch with no prompt (check 8c).

---

**See also**: [slskd Reference](slskd.md) (where downloads come from) · `python/fix_comments.py` (comment frame cleanup that stays in Python)
