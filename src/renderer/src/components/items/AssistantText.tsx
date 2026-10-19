import { Markdown } from '../Markdown'
import type { TextItem } from '../../store/useRelayStore'

export function AssistantText({ item }: { item: TextItem }): React.JSX.Element {
  return (
    <article className="ef-turn ef-turn-assistant">
      <div className="ef-turn-head">
        <span className="ef-label">ASSISTANT</span>
        <span className="ef-field">
          {item.done ? '完成' : '生成中'}
          <span className="ef-sep">│</span>
          {item.text.length} 字
        </span>
      </div>
      <Markdown text={item.text} />
      {!item.done ? <span className="ef-caret" aria-hidden="true" /> : null}
    </article>
  )
}
