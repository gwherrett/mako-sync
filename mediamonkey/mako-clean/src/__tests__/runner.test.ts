import { describe, it, expect } from 'vitest';
import {
  buildPreviewPayload,
  escapeHtml,
  formatSummaryHtml,
  planTrack,
  summarizeApply,
} from '../core/runner';
import { RULES } from '../core/rules';
import type { Rule, RuleContext, TrackInput } from '../core/types';

const ctx: RuleContext = { genreMap: new Map(), genreSeparator: '; ' };

function track(overrides: Partial<TrackInput['fields']> = {}, id = '1'): TrackInput {
  return {
    id,
    label: 'Artist - Title',
    file: 'Artist - Title.mp3',
    fields: { genre: 'Deep House', grouping: '', albumArtist: '', ...overrides },
  };
}

const setGrouping = (value: string, overwrite = false): Rule => ({
  id: `grouping-${value}`,
  run: () => ({ changes: [{ field: 'grouping', value, overwrite }] }),
});

describe('planTrack', () => {
  it('runs rules in order, each seeing the fields the earlier rules left', () => {
    const seen: string[] = [];
    const record: Rule = {
      id: 'record',
      run: (fields) => {
        seen.push(fields.grouping);
        return {};
      },
    };

    const plan = planTrack(track(), [setGrouping('House'), record, setGrouping('Disco'), record], ctx);

    expect(seen).toEqual(['House', 'Disco']);
    expect(plan.changes).toEqual([{ field: 'grouping', from: '', to: 'Disco', overwrite: false }]);
  });

  it("passes a rule's change and overwrite flag through to the plan", () => {
    const plan = planTrack(track({ grouping: 'Pop' }), [setGrouping('House', true)], ctx);
    expect(plan.changes).toEqual([{ field: 'grouping', from: 'Pop', to: 'House', overwrite: true }]);
  });

  it("doesn't list a field whose value doesn't change", () => {
    const plan = planTrack(track({ grouping: 'House' }), [setGrouping('House')], ctx);
    expect(plan.changes).toEqual([]);
  });

  it('drops a change that a later rule sets back to the original value', () => {
    const plan = planTrack(track({ grouping: 'Pop' }), [setGrouping('House'), setGrouping('Pop')], ctx);
    expect(plan.changes).toEqual([]);
  });

  it('collects skip reasons', () => {
    const skip: Rule = { id: 'skip', run: () => ({ skipReason: 'No SuperGenre for genres: zydeco' }) };
    const plan = planTrack(track(), [skip], ctx);
    expect(plan.skipReasons).toEqual(['No SuperGenre for genres: zydeco']);
  });

  it("doesn't change the input fields", () => {
    const input = track();
    planTrack(input, [setGrouping('House')], ctx);
    expect(input.fields.grouping).toBe('');
  });
});

describe('the shipped rule list', () => {
  it('previews "No changes" with no rules', () => {
    const payload = buildPreviewPayload([planTrack(track(), [], ctx)], '2026-11-21T00:00:00Z');
    expect(payload.rows).toEqual([]);
    expect(payload.changedTrackCount).toBe(0);
  });

  it('is an array of rules with unique ids', () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('buildPreviewPayload', () => {
  it('has one row per change and one note per skip reason', () => {
    const skip: Rule = { id: 'skip', run: () => ({ skipReason: 'No genre' }) };
    const plans = [
      planTrack(track({ grouping: 'Pop' }, 'a'), [setGrouping('House', true)], ctx),
      planTrack(track({}, 'b'), [skip], ctx),
    ];

    const payload = buildPreviewPayload(plans, '2026-11-21T00:00:00Z');

    expect(payload).toEqual({
      mapExportedAt: '2026-11-21T00:00:00Z',
      trackCount: 2,
      changedTrackCount: 1,
      rows: [{
        track: 'Artist - Title',
        file: 'Artist - Title.mp3',
        field: 'Grouping',
        from: 'Pop',
        to: 'House',
        overwrite: true,
      }],
      notes: [{ track: 'Artist - Title', file: 'Artist - Title.mp3', reason: 'No genre' }],
    });
    // The dialog receives it as JSON
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });
});

describe('summarizeApply', () => {
  const skip: Rule = { id: 'skip', run: () => ({ skipReason: 'No genre' }) };

  it('counts changed, unchanged, skipped and failed tracks', () => {
    const plans = [
      planTrack(track({}, 'changed'), [setGrouping('House')], ctx),
      planTrack(track({}, 'changed-with-note'), [setGrouping('House'), skip], ctx),
      planTrack(track({}, 'unchanged'), [], ctx),
      planTrack(track({}, 'skipped'), [skip], ctx),
      planTrack(track({}, 'failed'), [setGrouping('House')], ctx),
    ];

    const summary = summarizeApply(plans, new Map([['failed', 'Save failed: locked']]));

    expect(summary.changed).toBe(2);
    expect(summary.unchanged).toBe(1);
    expect(summary.skipped.map((n) => n.reason)).toEqual(['No genre']);
    expect(summary.notes.map((n) => n.reason)).toEqual(['No genre']);
    expect(summary.failed.map((n) => n.reason)).toEqual(['Save failed: locked']);
  });
});

describe('formatSummaryHtml', () => {
  it('shows the counts and escapes track text', () => {
    const html = formatSummaryHtml({
      changed: 1,
      unchanged: 2,
      skipped: [{ track: 'A & B - <Title>', file: 'x.mp3', reason: 'No genre' }],
      notes: [],
      failed: [],
    });

    expect(html).toContain('Changed: 1<br>Unchanged: 2<br>Skipped: 1');
    expect(html).toContain('A &amp; B - &lt;Title&gt; (x.mp3): No genre');
    expect(html).not.toContain('Failed');
  });

  it('caps each list at 25 lines', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ track: `T${i}`, file: `${i}.mp3`, reason: 'No genre' }));
    const html = formatSummaryHtml({ changed: 0, unchanged: 0, skipped: many, notes: [], failed: [] });
    expect(html).toContain('T24 (24.mp3)');
    expect(html).not.toContain('T25 (25.mp3)');
    expect(html).toContain('... and 5 more');
  });
});

describe('escapeHtml', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});
