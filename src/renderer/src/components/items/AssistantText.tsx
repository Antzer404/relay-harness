import { Markdown } from '../Markdown'
import type { TextItem } from '../../store/useRelayStore'

export function AssistantText({ item }: { item: TextItem }): React.JSX.Element {
  return (
    <article className="rly-msg rly-msg-assistant">
      <Markdown text={item.text} />
      {!item.done ? <span className="rly-caret" aria-hidden="true" /> : null}
    </article>
  )
}
