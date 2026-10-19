import { clock } from '../../lib/format'
import type { NoticeItem } from '../../store/useRelayStore'

export function NoticeRow({ item }: { item: NoticeItem }): React.JSX.Element {
  return (
    <article className="ef-notice">
      <span className="ef-label">NOTICE</span>
      <span className="ef-notice-text">{item.text}</span>
      <span className="ef-num">{clock(item.at)}</span>
    </article>
  )
}
