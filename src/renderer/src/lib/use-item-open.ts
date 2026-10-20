import { useCallback, useState } from 'react'
import { getItemOpen, setItemOpen } from './item-open-state'

/**
 * Persistent open/closed state for a timeline row. Survives unmount/remount
 * caused by virtual scrolling; resets only when the window reloads.
 */
export function useItemOpen(
  id: string,
  initial: boolean
): [boolean, () => void, number] {
  const [open, setOpen] = useState(() => getItemOpen(id) ?? initial)
  // Counts user toggles in this mount so the expanded panel animates on a
  // click but not when virtual scrolling remounts the row.
  const [toggles, setToggles] = useState(0)

  const toggle = useCallback(() => {
    setToggles((value) => value + 1)
    setOpen((value) => {
      const next = !value
      setItemOpen(id, next)
      return next
    })
  }, [id])

  return [open, toggle, toggles]
}
