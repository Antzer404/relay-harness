import { useCallback, useState } from 'react'
import { getItemOpen, setItemOpen } from './item-open-state'

/**
 * Persistent open/closed state for a timeline row. Survives unmount/remount
 * caused by virtual scrolling; resets only when the window reloads.
 */
export function useItemOpen(id: string, initial: boolean): [boolean, () => void] {
  const [open, setOpen] = useState(() => getItemOpen(id) ?? initial)

  const toggle = useCallback(() => {
    setOpen((value) => {
      const next = !value
      setItemOpen(id, next)
      return next
    })
  }, [id])

  return [open, toggle]
}
