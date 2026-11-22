/**
 * Mako Clean: MediaMonkey entry point.
 *
 * MediaMonkey appends an add-on's actions_add.js to its own actions.js, so this file
 * (built to an IIFE by `npm run mm:package`) can use MediaMonkey's globals. It's the
 * only part of the add-on that touches MediaMonkey objects: it reads the selected
 * tracks, runs the pure rules in src/core, shows the preview, and saves on Apply.
 *
 * API names come from docs/reference/mediamonkey-5.md.
 */

import { cleanPath, parseGenreMapExport, type GenreMapExport } from './core/genreMap';
import {
  buildPreviewPayload,
  escapeHtml,
  formatSummaryHtml,
  planTrack,
  summarizeApply,
} from './core/runner';
import { RULES } from './core/rules';
import type { EditableField, RuleContext, TrackInput, TrackPlan } from './core/types';

const SETTINGS_KEY = 'makoClean_settings';
const SETTINGS_HINT = 'Set it in Tools &gt; Addons: select Mako Clean and open its settings.';
const DEFAULT_SEPARATOR = '; ';

/** Track property MediaMonkey uses for each field a rule can change */
const TRACK_PROPS: Record<EditableField, 'groupDesc' | 'albumArtist'> = {
  grouping: 'groupDesc',
  albumArtist: 'albumArtist',
};

function showMessage(html: string, type: 'Information' | 'Error' = 'Information'): Promise<void> {
  return new Promise((resolve) => {
    messageDlg(html, type, ['btnOK'], { defaultButton: 'btnOK' }, () => resolve());
  });
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function genreSeparator(): string {
  try {
    const sep = window.settings.get('Appearance')?.Appearance?.MultiStringSeparator;
    if (sep && sep.trim()) return sep;
  } catch {
    // Fall back to MediaMonkey's default
  }
  return DEFAULT_SEPARATOR;
}

async function loadGenreMap(): Promise<GenreMapExport> {
  const settings = app.getValue(SETTINGS_KEY, { mapPath: '' });
  const mapPath = cleanPath(settings.mapPath || '');
  if (!mapPath) {
    throw new Error(`No genre map file is set. ${SETTINGS_HINT}`);
  }
  if (!(await app.filesystem.fileExistsAsync(mapPath))) {
    throw new Error(`The genre map file wasn't found: ${escapeHtml(mapPath)}. ${SETTINGS_HINT}`);
  }
  let text: string | null = null;
  let readError = '';
  try {
    text = await app.filesystem.loadTextFromFileAsync(mapPath);
  } catch (err) {
    readError = errorText(err);
  }
  if (text === null) {
    throw new Error(`The genre map file couldn't be read: ${escapeHtml(readError)}`);
  }
  return parseGenreMapExport(text);
}

function toInput(track: MMTrack): TrackInput {
  const path = track.path || '';
  return {
    id: String(track.id ?? path),
    label: `${track.artist || '(no artist)'} - ${track.title || '(no title)'}`,
    file: path.split(/[\\/]/).pop() || path,
    fields: {
      genre: track.genre || '',
      grouping: track.groupDesc || '',
      albumArtist: track.albumArtist || '',
    },
  };
}

/** listAsyncForEach as a promise. `fn` must handle its own errors. */
function eachTrack(list: MMTrackList, fn: (track: MMTrack) => void | Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    listAsyncForEach(
      list,
      (track, next) => {
        Promise.resolve()
          .then(() => fn(track))
          .then(
            () => next(),
            () => next()
          );
      },
      resolve
    );
  });
}

/**
 * Apply runs the rules again on each track rather than reusing the preview's plan,
 * so it works from the tags as they are at that moment. It saves each changed track
 * on its own, so tracks with no change aren't rewritten.
 */
async function applyChanges(list: MMTrackList, ctx: RuleContext): Promise<string> {
  const plans: TrackPlan[] = [];
  const failures = new Map<string, string>();

  await eachTrack(list, async (track) => {
    const plan = planTrack(toInput(track), RULES, ctx);
    plans.push(plan);
    if (plan.changes.length === 0) return;
    try {
      track.beginUpdate();
      for (const change of plan.changes) {
        track[TRACK_PROPS[change.field]] = change.to;
      }
      track.endUpdate();
      await track.commitAsync();
    } catch (err) {
      failures.set(plan.id, `Save failed: ${errorText(err)}`);
    }
  });

  return formatSummaryHtml(summarizeApply(plans, failures));
}

async function cleanSelectedTracks(): Promise<void> {
  const list = uitools.getSelectedTracklist();
  await list.whenLoaded();
  if (!list.count) {
    await showMessage('Select one or more tracks first.');
    return;
  }

  let genreMap: GenreMapExport;
  try {
    genreMap = await loadGenreMap();
  } catch (err) {
    await showMessage(errorText(err), 'Error');
    return;
  }

  const ctx: RuleContext = { genreMap: genreMap.map, genreSeparator: genreSeparator() };
  const plans: TrackPlan[] = [];
  await eachTrack(list, (track) => {
    plans.push(planTrack(toInput(track), RULES, ctx));
  });

  const payload = buildPreviewPayload(plans, genreMap.exportedAt);
  uitools.openDialog(
    'dlgMakoCleanPreview',
    {
      modal: true,
      title: 'Mako Clean: preview',
      payloadJson: JSON.stringify(payload),
    },
    (dialog) => {
      if (dialog.modalResult !== 1) return;
      applyChanges(list, ctx)
        .then((summaryHtml) => showMessage(summaryHtml))
        .catch((err) => showMessage(`Apply stopped: ${escapeHtml(errorText(err))}`, 'Error'));
    }
  );
}

actions.makoClean = {
  title: 'Mako: Clean selected tracks...',
  hotkeyAble: true,
  disabled: uitools.notMediaListSelected,
  visible: uitools.getCanEdit,
  execute: () => {
    cleanSelectedTracks().catch((err) =>
      showMessage(`Mako Clean stopped: ${escapeHtml(errorText(err))}`, 'Error')
    );
  },
};

window._menuItems.editTags.action.submenu.push({
  action: actions.makoClean,
  order: 90,
  grouporder: 10,
});
