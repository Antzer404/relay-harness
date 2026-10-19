import { useState } from 'react'
import { duration, prettyJson, toolSummary } from '../../lib/format'
import type { ToolItem } from '../../store/useRelayStore'

const STATUS_LABEL: Record<ToolItem['status'], string> = {
  running: '运行中',
  done: '完成',
  error: '返回错误'
}

function clip(value: string, limit = 20_000): string {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n… [已截断，共 ${value.length} 字符]`
}

export function ToolCard({ item }: { item: ToolItem }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const summary = toolSummary(item.name, item.input)

  return (
    <article className={`ef-tool ef-tool-${item.status}`}>
      {item.status === 'running' ? <div className="ef-tool-hatch" aria-hidden="true" /> : null}
      <button
        type="button"
        className="ef-tool-head"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={`ef-tool-status ef-tool-status-${item.status}`} aria-hidden="true" />
        <span className="ef-tool-name">{item.name}</span>
        <span className="ef-label">{STATUS_LABEL[item.status]}</span>
        <span className="ef-tool-meta ef-num">
          {duration(item.durationMs)} <span className="ef-sep">│</span> {open ? '收起参数' : '查看参数'}
        </span>
      </button>

      <div className="ef-tool-summary" title={summary}>
        <span className="ef-label">CALL</span>
        <code>{summary}</code>
      </div>

      {open ? (
        <div className="ef-tool-detail">
          <div className="ef-detail-block">
            <div className="ef-label">INPUT</div>
            <pre>{clip(prettyJson(item.input))}</pre>
          </div>
          <div className="ef-detail-block">
            <div className="ef-label">RESULT</div>
            {item.output === undefined ? (
              <p className="ef-detail-note">
                {item.status === 'running' ? '等待工具返回…' : '没有可显示的输出。'}
              </p>
            ) : (
              <pre className={item.isError ? 'is-error' : undefined}>{clip(item.output)}</pre>
            )}
          </div>
        </div>
      ) : null}
    </article>
  )
}
