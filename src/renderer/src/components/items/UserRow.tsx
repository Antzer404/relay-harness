import type { UserItem } from '../../store/useRelayStore'

export function UserRow({ item }: { item: UserItem }): React.JSX.Element {
  const tag = item.interrupted ? '打断插入' : item.inserted ? '本轮插入' : null
  return (
    <article className="rly-msg rly-msg-user">
      {tag ? <span className="rly-user-tag">{tag}</span> : null}
      <div className="rly-bubble">{item.text}</div>
    </article>
  )
}
