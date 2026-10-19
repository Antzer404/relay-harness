import type { NoticeItem } from '../../store/useRelayStore'

export function NoticeRow({ item }: { item: NoticeItem }): React.JSX.Element {
  return (
    <article className="rly-notice" role="status">
      <span className="rly-notice-line" aria-hidden="true" />
      <span>{item.text}</span>
      <span className="rly-notice-line" aria-hidden="true" />
    </article>
  )
}
