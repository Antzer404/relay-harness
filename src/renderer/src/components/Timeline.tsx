import { memo, useEffect, useMemo, useRef } from 'react'
import { useRelayStore } from '../store/useRelayStore'
import { useVirtualTimeline } from '../hooks/useVirtualTimeline'
import { groupTimeline, type TimelineRow } from '../lib/timeline-groups'
import { ProcessGroup } from './ProcessGroup'
import { TimelineItemView } from './TimelineItemView'
import { IconSpark } from './icons'

function renderRow(row: TimelineRow): React.JSX.Element | null {
  if (row.kind === 'group') return <ProcessGroup group={row} />
  return <TimelineItemView item={row} />
}

/**
 * Historical items keep their object identity (the reducer only replaces the
 * streaming tail), so memoized rows skip diffing and Markdown parsing while
 * scrolling. Only the live tail re-renders per delta.
 */
export function rowsEqual(previous: { row: TimelineRow }, next: { row: TimelineRow }): boolean {
  const a = previous.row
  const b = next.row
  if (a === b) return true
  if (a.kind !== 'group' || b.kind !== 'group') return false
  if (a.id !== b.id || a.status !== b.status || a.endedAt !== b.endedAt) return false
  if (a.items.length !== b.items.length) return false
  for (let index = 0; index < a.items.length; index += 1) {
    if (a.items[index] !== b.items[index]) return false
  }
  return true
}

const TimelineRowView = memo(
  function TimelineRowView({ row }: { row: TimelineRow }): React.JSX.Element | null {
    return renderRow(row)
  },
  // Group objects are rebuilt on every reducer step; compare their members so
  // historical groups skip re-rendering while the tail streams.
  rowsEqual
)

const STARTERS = [
  '查看当前目录，简要说明这个项目在做什么',
  '找出最近修改过的文件，并解释这些改动',
  '写一个小脚本完成一件具体的事，然后运行它'
]

function Welcome(): React.JSX.Element {
  const setDraft = useRelayStore((state) => state.setDraft)
  const hasKey = useRelayStore((state) => state.bootstrap?.hasApiKey ?? false)

  return (
    <div className="rly-welcome">
      <div className="rly-welcome-mark" aria-hidden="true">
        <IconSpark size={22} />
      </div>
      <h1 className="rly-welcome-title">开始一项工作</h1>
      <p className="rly-welcome-sub">
        {hasKey
          ? '描述你想完成的事。思考过程、工具调用和结果会按顺序出现在这里。'
          : '先在设置中保存 DeepSeek API Key，然后就可以开始。'}
      </p>
      {hasKey ? (
        <div className="rly-starters">
          {STARTERS.map((text) => (
            <button
              key={text}
              type="button"
              className="rly-starter"
              onClick={() => {
                setDraft(text)
                window.dispatchEvent(new CustomEvent('relay:focus-composer'))
              }}
            >
              {text}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function Timeline(): React.JSX.Element {
  const items = useRelayStore((state) => state.items)
  const phase = useRelayStore((state) => state.phase)
  const activeId = useRelayStore((state) => state.activeId)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Consecutive thinking/tool rows collapse into one "process" row so user
  // messages stay easy to find when scrolling back through a long session.
  const rows = useMemo(() => groupTimeline(items), [items])

  const { layout, start, end, detached, registerRow, onScroll, scrollToBottom } =
    useVirtualTimeline({ rows, scrollRef, resetKey: activeId })

  // A permission request blocks the turn; pull the view back to the tail so
  // the pending card cannot be missed while the user is reading history.
  const pendingPermission = items.some(
    (item) => item.kind === 'permission' && item.status === 'pending'
  )
  useEffect(() => {
    if (pendingPermission) scrollToBottom()
  }, [pendingPermission, scrollToBottom])

  return (
    <div className="rly-timeline-wrap">
      <section className="rly-timeline" ref={scrollRef} onScroll={onScroll}>
        {items.length === 0 ? (
          <Welcome />
        ) : (
          <div className="rly-vlist" style={{ height: layout.total }}>
            {rows.slice(start, end).map((row, offset) => {
              const index = start + offset
              return (
                <div
                  key={row.id}
                  className="rly-vrow"
                  data-item-id={row.id}
                  ref={registerRow(row.id)}
                  style={{ transform: `translateY(${layout.offsets[index] ?? 0}px)` }}
                >
                  <TimelineRowView row={row} />
                </div>
              )
            })}
          </div>
        )}
        {phase === 'busy' || phase === 'starting' ? (
          <div className="rly-running" aria-label="模型正在工作">
            <span className="rly-running-dot" />
            <span className="rly-running-dot" />
            <span className="rly-running-dot" />
          </div>
        ) : null}
      </section>
      {detached && items.length > 0 ? (
        <button type="button" className="rly-jump" onClick={scrollToBottom}>
          回到最新
        </button>
      ) : null}
    </div>
  )
}
