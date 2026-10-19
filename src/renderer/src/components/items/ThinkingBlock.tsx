import { useEffect, useRef, useState } from 'react'
import type { ThinkingItem } from '../../store/useRelayStore'

export function ThinkingBlock({ item }: { item: ThinkingItem }): React.JSX.Element {
  const [open, setOpen] = useState(!item.done)
  const touched = useRef(false)

  useEffect(() => {
    if (!touched.current) setOpen(!item.done)
  }, [item.done])

  const empty = item.text.trim().length === 0

  return (
    <article className={`ef-thinking${open ? ' is-open' : ''}`}>
      <div className="ef-thinking-hatch" aria-hidden="true" />
      <button
        type="button"
        className="ef-thinking-head"
        aria-expanded={open}
        onClick={() => {
          touched.current = true
          setOpen((value) => !value)
        }}
      >
        <span className={`ef-thinking-mark${item.done ? '' : ' is-live'}`} aria-hidden="true" />
        <span className="ef-label">THINKING</span>
        <span className="ef-thinking-title">思维链</span>
        <span className="ef-thinking-meta ef-num">
          {item.done ? 'DONE' : 'STREAM'} <span className="ef-sep">│</span> {item.text.length} 字
        </span>
        <span className="ef-thinking-toggle ef-label">{open ? '收起' : '展开'}</span>
      </button>
      {open ? (
        <div className="ef-thinking-body">
          {empty ? (
            <span className="ef-thinking-empty">该模型未返回思维链。</span>
          ) : (
            <pre>{item.text}</pre>
          )}
        </div>
      ) : null}
    </article>
  )
}
