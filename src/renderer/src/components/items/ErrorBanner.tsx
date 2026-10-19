import { useRelayStore, type ErrorItem } from '../../store/useRelayStore'

export function ErrorBanner({ item }: { item: ErrorItem }): React.JSX.Element {
  const retryLast = useRelayStore((state) => state.retryLast)
  const phase = useRelayStore((state) => state.phase)
  const busy = phase === 'busy' || phase === 'starting'

  return (
    <article className="rly-error" role="alert">
      <span className="rly-error-mark" aria-hidden="true">
        !
      </span>
      <div className="rly-error-body">
        <p>{item.message}</p>
        {item.retryable ? <span className="rly-error-hint">可重试</span> : null}
      </div>
      <button
        type="button"
        className="rly-btn rly-btn-ghost"
        disabled={busy}
        onClick={() => void retryLast()}
      >
        重试上一条
      </button>
    </article>
  )
}
