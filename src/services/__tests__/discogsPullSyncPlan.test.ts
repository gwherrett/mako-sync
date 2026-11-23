import { describe, it, expect } from 'vitest';
import { planPullSync, type PlannableItem } from '../../../supabase/functions/discogs-pull-sync/plan.ts';

// In the Discogs collection API, `id` is the release id and `instance_id` is the copy.
const item = (releaseId: number, instanceId: number): PlannableItem => ({
  id: releaseId,
  instance_id: instanceId,
  basic_information: { id: releaseId },
});

describe('planPullSync', () => {
  it('skips an item whose instance id is already stored', () => {
    const plan = planPullSync([item(100, 9001)], new Set([9001]), []);
    expect(plan.toLink).toEqual([]);
    expect(plan.toInsert).toEqual([]);
  });

  it('links a row with no instance id to the item with the same release id', () => {
    const plan = planPullSync([item(100, 9001)], new Set(), [{ id: 'row-a', discogs_release_id: 100 }]);
    expect(plan.toLink).toEqual([{ rowId: 'row-a', instanceId: 9001 }]);
    expect(plan.toInsert).toEqual([]);
  });

  it('links each copy of a release to its own row and inserts any extra copy', () => {
    const items = [item(100, 9001), item(100, 9002), item(100, 9003)];
    const legacy = [
      { id: 'row-a', discogs_release_id: 100 },
      { id: 'row-b', discogs_release_id: 100 },
    ];
    const plan = planPullSync(items, new Set(), legacy);
    expect(plan.toLink).toEqual([
      { rowId: 'row-a', instanceId: 9001 },
      { rowId: 'row-b', instanceId: 9002 },
    ]);
    expect(plan.toInsert).toEqual([items[2]]);
  });

  it('inserts an item with no matching row', () => {
    const plan = planPullSync([item(200, 9100)], new Set([9001]), [{ id: 'row-a', discogs_release_id: 100 }]);
    expect(plan.toLink).toEqual([]);
    expect(plan.toInsert).toEqual([item(200, 9100)]);
  });

  it('dedups by instance_id, not by the release id in `id`', () => {
    // A stored release id that happens to equal an id is not a match
    const plan = planPullSync([item(100, 9001)], new Set([100]), []);
    expect(plan.toInsert).toEqual([item(100, 9001)]);
  });

  it('ignores legacy rows that have no release id', () => {
    const plan = planPullSync([item(100, 9001)], new Set(), [{ id: 'row-a', discogs_release_id: null }]);
    expect(plan.toLink).toEqual([]);
    expect(plan.toInsert).toEqual([item(100, 9001)]);
  });

  it('handles the same instance appearing twice across pages only once', () => {
    const plan = planPullSync([item(100, 9001), item(100, 9001)], new Set(), [
      { id: 'row-a', discogs_release_id: 100 },
      { id: 'row-b', discogs_release_id: 100 },
    ]);
    expect(plan.toLink).toEqual([{ rowId: 'row-a', instanceId: 9001 }]);
    expect(plan.toInsert).toEqual([]);
  });

  it('a second sync after linking is a no-op', () => {
    const items = [item(100, 9001), item(200, 9002)];
    const first = planPullSync(items, new Set(), [
      { id: 'row-a', discogs_release_id: 100 },
      { id: 'row-b', discogs_release_id: 200 },
    ]);
    const stored = new Set(first.toLink.map(l => l.instanceId));
    const second = planPullSync(items, stored, []);
    expect(second.toLink).toEqual([]);
    expect(second.toInsert).toEqual([]);
  });
});
