import { useEffect, useState } from 'react'
import type { ThinkingItem } from '../../store/useRelayStore'
import { duration } from '../../lib/format'
import { getItemOpen, setItemOpen } from '../../lib/item-open-state'
import { IconChevron } from '../icons'

export function ThinkingBlock({ item }: { item: ThinkingItem }): React.JSX.Element | null {
  // Open while streaming, collapsed once done — unless the user toggled it.
  // The toggle lives outside the component so virtual scrolling cannot lose it.
  const [open, setOpen] = useState(() => getItemOpen(item.id) ?? !item.done)

  useEffect(() => {
    if (getItemOpen(item.id) === undefined) setOpen(!item.done)
  }, [item.id, item.done])

  if (item.text.trim().length === 0) return null

  return (
    <article className={`rly-thinking${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="rly-thinking-head"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => {
            const next = !value
            setItemOpen(item.id, next)
            return next
          })
        }}
      >
        <span className={`rly-thinking-dot${item.done ? '' : ' is-live'}`} aria-hidden="true" />
        <span className="rly-thinking-label">{item.done ? '思考' : '正在思考'}</span>
        {item.done ? (
          item.durationMs ? (
            <span className="rly-thinking-duration">{duration(item.durationMs)}</span>
          ) : null
        ) : null}
        <IconChevron size={13} />
      </button>
      {open ? (
        <div className="rly-thinking-body">
          <pre>{item.text}</pre>
        </div>
      ) : null}
    </article>
  )
}
