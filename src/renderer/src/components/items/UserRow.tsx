import type { UserItem } from '../../store/useRelayStore'

export function UserRow({ item }: { item: UserItem }): React.JSX.Element {
  return (
    <article className="rly-msg rly-msg-user">
      <div className="rly-bubble">{item.text}</div>
    </article>
  )
}
