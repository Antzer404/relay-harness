import { useEffect, useRef, useState } from 'react'
import { duration } from '../lib/format'
import { getGroupOpen, setGroupOpen } from '../lib/item-open-state'
import type { ProcessGroupItem } from '../lib/timeline-groups'
import { IconChevron } from './icons'
import { TimelineItemView } from './TimelineItemView'

const STATUS_LABEL: Record<ProcessGroupItem['status'], string> = {
  running: '进行中',
  done: '已完成',
  error: '有失败'
}

function summaryOf(group: ProcessGroupItem): string {
  const thinking = group.items.filter((item) => item.kind === 'thinking').length
  const tools = group.items.filter((item) => item.kind === 'tool')
  const parts: string[] = []
  if (thinking > 0) parts.push(`思考 ${thinking} 段`)
  if (tools.length > 0) {
    const counts = new Map<string, number>()
    for (const tool of tools) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1)
    const names = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([name, count]) => (count > 1 ? `${name}×${count}` : name))
      .join(' · ')
    parts.push(`工具 ${tools.length} 次（${names}）`)
  }
  return parts.join(' · ')
}

/**
 * One collapsed row for a run of thinking/tool activity. It opens while the
 * run is live and folds itself once the run finishes, unless the user has
 * toggled it; expansion state is kept in the module-level store so virtual
 * scrolling does not lose it.
 */
export function ProcessGroup({ group }: { group: ProcessGroupItem }): React.JSX.Element {
  const [open, setOpen] = useState(
    () => getGroupOpen(group.id) ?? group.status === 'running'
  )
  const touched = useRef(getGroupOpen(group.id) !== undefined)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (touched.current) return
    setOpen(group.status === 'running')
  }, [group.status])

  useEffect(() => {
    if (group.status !== 'running') return
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [group.status])

  const toggle = (): void => {
    touched.current = true
    setOpen((value) => {
      setGroupOpen(group.id, !value)
      return !value
    })
  }

  const span = (group.endedAt ?? Date.now()) - group.startedAt
  // `tick` participates only to refresh the live duration while running.
  void tick

  return (
    <section className={`rly-group is-${group.status}${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="rly-group-head"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="rly-group-dot" aria-hidden="true" />
        <span className="rly-group-label">过程</span>
        <span className="rly-group-summary">{summaryOf(group) || '思考与工具调用'}</span>
        <span className="rly-group-meta">
          {STATUS_LABEL[group.status]} · {duration(span)}
        </span>
        <span className={`rly-group-chevron${open ? ' is-open' : ''}`} aria-hidden="true">
          <IconChevron size={13} />
        </span>
      </button>
      {open ? (
        <div className="rly-group-body">
          {group.items.map((item) => (
            <TimelineItemView key={item.id} item={item} />
          ))}
        </div>
      ) : null}
    </section>
  )
}
