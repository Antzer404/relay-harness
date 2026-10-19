/**
 * Expansion state for timeline rows that is not part of the item data.
 *
 * Virtual scrolling unmounts rows that leave the viewport, so component-local
 * state would be lost when a tool card scrolls out and back. Keeping the
 * toggles in a module-level map makes them stable for the lifetime of the
 * window; item ids are unique per created item, so sessions do not collide.
 */
const overrides = new Map<string, boolean>()

export function getItemOpen(id: string): boolean | undefined {
  return overrides.get(id)
}

export function setItemOpen(id: string, open: boolean): void {
  if (overrides.size > 20_000) overrides.clear()
  overrides.set(id, open)
}

/** Key for the permission card's parameter preview toggle. */
export function permissionParamsKey(itemId: string): string {
  return `${itemId}:params`
}
