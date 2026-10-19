import { useEffect, useRef, useState } from 'react'
import type { ThinkingItem } from '../../store/useRelayStore'
import { duration } from '../../lib/format'
import { IconChevron } from '../icons'

export function ThinkingBlock({ item }: { item: ThinkingItem }): React.JSX.Element | null {
  const [open, setOpen] = useState(!item.done)
  const touched = useRef(false)

  useEffect(() => {
    if (!touched.current) setOpen(!item.done)
  }, [item.done])

  if (item.text.trim().length === 0) return null

  return (
    <article className={`rly-thinking${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="rly-thinking-head"
        aria-expanded={open}
        onClick={() => {
          touched.current = true
          setOpen((value) => !value)
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
