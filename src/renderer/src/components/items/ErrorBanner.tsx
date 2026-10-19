import { clock } from '../../lib/format'
import type { ErrorItem } from '../../store/useRelayStore'

export function ErrorBanner({ item }: { item: ErrorItem }): React.JSX.Element {
  return (
    <article className="ef-alert" role="alert">
      <div className="ef-alert-flag" aria-hidden="true" />
      <div className="ef-alert-body">
        <div className="ef-alert-head">
          <span className="ef-label">ERROR</span>
          <span className="ef-field">
            {item.retryable ? '可重试' : '需要处理'} <span className="ef-sep">│</span>{' '}
            {clock(item.at)}
          </span>
        </div>
        <p>{item.message}</p>
      </div>
    </article>
  )
}
