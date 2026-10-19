import { duration, prettyJson, toolSummary } from '../../lib/format'
import { useItemOpen } from '../../lib/use-item-open'
import type { ToolItem } from '../../store/useRelayStore'
import { IconChevron } from '../icons'
import { DiffView } from './DiffView'

function clip(value: string, limit = 20_000): string {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n… [已截断，共 ${value.length} 字符]`
}

const TOOL_GLYPH: Record<string, string> = {
  Read: 'R',
  Write: 'W',
  Edit: 'E',
  Bash: '>_',
  Grep: 'G',
  Glob: 'G',
  WebFetch: 'W',
  WebSearch: 'W',
  Task: 'T',
  TodoWrite: '✓'
}

export function ToolCard({ item }: { item: ToolItem }): React.JSX.Element {
  // Kept outside the component so scrolling the card out of the virtual
  // window does not collapse it.
  const [open, toggleOpen] = useItemOpen(item.id, false)
  const summary = toolSummary(item.name, item.input)
  const glyph = TOOL_GLYPH[item.name] ?? item.name.slice(0, 1).toUpperCase()

  return (
    <article className={`rly-tool is-${item.status}`}>
      <button
        type="button"
        className="rly-tool-row"
        aria-expanded={open}
        onClick={toggleOpen}
      >
        <span className="rly-tool-glyph" aria-hidden="true">
          {glyph}
        </span>
        <span className="rly-tool-name">{item.name}</span>
        <span className="rly-tool-summary" title={summary}>
          {summary}
        </span>
        {item.diff ? (
          <span className="rly-tool-diffstat" title="新增 / 删除行数">
            <span className="is-add">+{item.diff.added}</span>
            <span className="is-del">−{item.diff.removed}</span>
          </span>
        ) : null}
        <span className="rly-tool-meta">
          {item.status === 'running' ? (
            <span className="rly-tool-runner" aria-label="运行中" />
          ) : item.status === 'error' ? (
            '失败'
          ) : (
            duration(item.durationMs)
          )}
        </span>
        <span className={`rly-tool-chevron${open ? ' is-open' : ''}`}>
          <IconChevron size={13} />
        </span>
      </button>

      {open ? (
        <div className="rly-tool-detail">
          {item.diff ? (
            <div className="rly-tool-block">
              <div className="rly-tool-block-label">改动</div>
              <DiffView diff={item.diff} />
            </div>
          ) : (
            <div className="rly-tool-block">
              <div className="rly-tool-block-label">输入</div>
              <pre>{clip(prettyJson(item.input))}</pre>
            </div>
          )}
          <div className="rly-tool-block">
            <div className="rly-tool-block-label">结果</div>
            {item.output === undefined ? (
              <p className="rly-tool-pending">
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
