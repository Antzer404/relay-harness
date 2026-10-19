import { clock } from '../../lib/format'
import type { UserItem } from '../../store/useRelayStore'

export function UserRow({ item }: { item: UserItem }): React.JSX.Element {
  return (
    <article className="ef-turn ef-turn-user">
      <div className="ef-turn-head">
        <span className="ef-record-no ef-num">No.{String(item.turn).padStart(3, '0')}</span>
        <span className="ef-field">
          USER <span className="ef-sep">│</span> {clock(item.at)}
        </span>
      </div>
      <div className="ef-user-text">{item.text}</div>
    </article>
  )
}
