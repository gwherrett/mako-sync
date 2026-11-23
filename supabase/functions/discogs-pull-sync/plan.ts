// Pure sync planning for discogs-pull-sync. No Deno or Supabase imports so
// vitest can test it (src/services/__tests__/discogsPullSyncPlan.test.ts).

/**
 * The fields of a Discogs collection item that planning needs. In the Discogs
 * collection API, `id` is the RELEASE id; `instance_id` identifies this copy
 * in the user's collection. Never use `id` as the instance id.
 */
export interface PlannableItem {
  id: number
  instance_id: number
  basic_information: { id: number }
}

/** A physical_media row that has no discogs_instance_id yet. */
export interface LegacyRow {
  id: string
  discogs_release_id: number | null
}

export interface LinkAction {
  rowId: string
  instanceId: number
}

export interface PullSyncPlan<T extends PlannableItem> {
  /** Existing rows to tag with the instance id they correspond to. */
  toLink: LinkAction[]
  /** Items with no existing row; these are enriched and inserted. */
  toInsert: T[]
}

/**
 * Decide what to do with each item in the user's Discogs collection:
 * - skip it if a row already carries its instance id
 * - otherwise link it to an unclaimed row of the same release that has no
 *   instance id (one row per copy, so two copies of a release link two rows)
 * - otherwise insert it
 */
export function planPullSync<T extends PlannableItem>(
  items: T[],
  existingInstanceIds: Set<number>,
  legacyRows: LegacyRow[],
): PullSyncPlan<T> {
  const unclaimedByRelease = new Map<number, string[]>()
  for (const row of legacyRows) {
    if (row.discogs_release_id == null) continue
    const ids = unclaimedByRelease.get(row.discogs_release_id) ?? []
    ids.push(row.id)
    unclaimedByRelease.set(row.discogs_release_id, ids)
  }

  const toLink: LinkAction[] = []
  const toInsert: T[] = []
  const seenInstanceIds = new Set<number>()

  for (const item of items) {
    if (existingInstanceIds.has(item.instance_id)) continue
    // Guard against the same instance appearing twice across pages
    if (seenInstanceIds.has(item.instance_id)) continue
    seenInstanceIds.add(item.instance_id)

    const releaseId = item.basic_information?.id ?? item.id
    const rowId = unclaimedByRelease.get(releaseId)?.shift()
    if (rowId) {
      toLink.push({ rowId, instanceId: item.instance_id })
    } else {
      toInsert.push(item)
    }
  }

  return { toLink, toInsert }
}
