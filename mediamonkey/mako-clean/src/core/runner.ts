import { FIELD_LABELS } from './types';
import type { FieldChange, Rule, RuleContext, TrackInput, TrackPlan } from './types';

/**
 * Run the rules on one track, in order. Each rule sees the fields as the earlier
 * rules left them. A change back to the original value is dropped, so an unchanged
 * field is never listed.
 */
export function planTrack(input: TrackInput, rules: Rule[], ctx: RuleContext): TrackPlan {
  const working = { ...input.fields };
  const changes = new Map<FieldChange['field'], FieldChange>();
  const skipReasons: string[] = [];

  for (const rule of rules) {
    const result = rule.run(working, ctx);
    if (result.skipReason) skipReasons.push(result.skipReason);

    for (const change of result.changes ?? []) {
      const original = input.fields[change.field];
      working[change.field] = change.value;
      if (change.value === original) {
        changes.delete(change.field);
      } else {
        changes.set(change.field, {
          field: change.field,
          from: original,
          to: change.value,
          overwrite: Boolean(change.overwrite),
        });
      }
    }
  }

  return {
    id: input.id,
    label: input.label,
    file: input.file,
    changes: [...changes.values()],
    skipReasons,
  };
}

export interface Note {
  track: string;
  file: string;
  reason: string;
}

export interface PreviewRow {
  track: string;
  file: string;
  field: string;
  from: string;
  to: string;
  overwrite: boolean;
}

/** What the preview dialog shows. Plain data: it's passed to the dialog as JSON. */
export interface PreviewPayload {
  mapExportedAt: string;
  trackCount: number;
  changedTrackCount: number;
  rows: PreviewRow[];
  notes: Note[];
}

export function buildPreviewPayload(plans: TrackPlan[], mapExportedAt: string): PreviewPayload {
  const rows: PreviewRow[] = [];
  const notes: Note[] = [];

  for (const plan of plans) {
    for (const change of plan.changes) {
      rows.push({
        track: plan.label,
        file: plan.file,
        field: FIELD_LABELS[change.field],
        from: change.from,
        to: change.to,
        overwrite: change.overwrite,
      });
    }
    for (const reason of plan.skipReasons) {
      notes.push({ track: plan.label, file: plan.file, reason });
    }
  }

  return {
    mapExportedAt,
    trackCount: plans.length,
    changedTrackCount: plans.filter((p) => p.changes.length > 0).length,
    rows,
    notes,
  };
}

export interface ApplySummary {
  changed: number;
  unchanged: number;
  /** Tracks with nothing to change and a reason worth showing */
  skipped: Note[];
  /** Tracks that were changed but also had a reason to show (e.g. Album Artist fixed, genre unmapped) */
  notes: Note[];
  failed: Note[];
}

/**
 * Tally what Apply did. `failures` maps a track id to why its save failed.
 */
export function summarizeApply(plans: TrackPlan[], failures: Map<string, string>): ApplySummary {
  const summary: ApplySummary = { changed: 0, unchanged: 0, skipped: [], notes: [], failed: [] };

  for (const plan of plans) {
    const failure = failures.get(plan.id);
    if (failure !== undefined) {
      summary.failed.push({ track: plan.label, file: plan.file, reason: failure });
      continue;
    }
    const reasons = plan.skipReasons.map((reason) => ({ track: plan.label, file: plan.file, reason }));
    if (plan.changes.length > 0) {
      summary.changed++;
      summary.notes.push(...reasons);
    } else if (reasons.length > 0) {
      summary.skipped.push(...reasons);
    } else {
      summary.unchanged++;
    }
  }

  return summary;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const MAX_SUMMARY_NOTES = 25;

/** The message shown after Apply. MediaMonkey's messageDlg renders HTML. */
export function formatSummaryHtml(summary: ApplySummary): string {
  const lines = [
    `Changed: ${summary.changed}`,
    `Unchanged: ${summary.unchanged}`,
    `Skipped: ${summary.skipped.length}`,
  ];
  if (summary.failed.length > 0) lines.push(`Failed: ${summary.failed.length}`);

  const sections: [string, Note[]][] = [
    ['Failed', summary.failed],
    ['Skipped', summary.skipped],
    ['Changed, with a note', summary.notes],
  ];
  for (const [title, list] of sections) {
    if (list.length === 0) continue;
    lines.push('', `<b>${title}</b>`);
    for (const note of list.slice(0, MAX_SUMMARY_NOTES)) {
      lines.push(`${escapeHtml(note.track)} (${escapeHtml(note.file)}): ${escapeHtml(note.reason)}`);
    }
    if (list.length > MAX_SUMMARY_NOTES) {
      lines.push(`... and ${list.length - MAX_SUMMARY_NOTES} more`);
    }
  }

  return lines.join('<br>');
}
