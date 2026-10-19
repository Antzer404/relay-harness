import { useEffect, useRef } from 'react'
import { useRelayStore } from '../store/useRelayStore'
import { cost, number, shortModel } from '../lib/format'

export function Composer(): React.JSX.Element {
  const draft = useRelayStore((state) => state.draft)
  const setDraft = useRelayStore((state) => state.setDraft)
  const send = useRelayStore((state) => state.send)
  const interrupt = useRelayStore((state) => state.interrupt)
  const session = useRelayStore((state) => state.session)
  const phase = useRelayStore((state) => state.phase)
  const usage = useRelayStore((state) => state.usage)
  const bootstrap = useRelayStore((state) => state.bootstrap)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const busy = phase === 'busy' || phase === 'starting'
  const hasKey = bootstrap?.hasApiKey ?? false
  const ready = Boolean(session) && hasKey && !busy
  const percent = usage?.percent ?? 0
  const high = percent >= 75

  useEffect(() => {
    const node = textareaRef.current
    if (!node) return
    node.style.height = '0px'
    node.style.height = `${Math.min(node.scrollHeight, 168)}px`
  }, [draft])

  const submit = (): void => {
    if (!ready) return
    const text = draft
    if (!text.trim()) return
    void send(text)
  }

  return (
    <section className="ef-composer">
      <div className="ef-meter">
        <div className="ef-meter-labels">
          <span className="ef-label">CONTEXT</span>
          <span className="ef-num">
            {usage
              ? `${number(usage.contextTokens)} / ${number(usage.contextWindow)}`
              : '等待首轮用量'}
          </span>
          <span className={`ef-meter-pct ef-num${high ? ' is-high' : ''}`}>
            {usage ? `${percent.toFixed(1)}%` : '—'}
          </span>
          <span className="ef-meter-spacer" />
          <span className="ef-field">
            IN <span className="ef-num">{usage ? number(usage.inputTokens) : '—'}</span>
            <span className="ef-sep">│</span>
            OUT <span className="ef-num">{usage ? number(usage.outputTokens) : '—'}</span>
            <span className="ef-sep">│</span>
            CACHE{' '}
            <span className="ef-num">
              {usage ? number(usage.cacheRead + usage.cacheWrite) : '—'}
            </span>
            <span className="ef-sep">│</span>
            SESSION <span className="ef-num">{usage ? cost(usage.costUsd) : '—'}</span>
          </span>
        </div>
        <div
          className={`ef-meter-track${high ? ' is-high' : ''}`}
          role="meter"
          aria-label="上下文占用"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span className="ef-meter-fill" style={{ width: `${Math.min(100, percent)}%` }} />
          <span className="ef-meter-tick" style={{ left: '75%' }} aria-hidden="true" />
        </div>
        <div className="ef-meter-foot">
          <span className="ef-label">
            {high ? '上下文接近上限' : usage ? '用量为估算值' : '尚未收到 usage'}
          </span>
          <span className="ef-field">
            {shortModel(usage?.model ?? session?.model)} <span className="ef-sep">│</span>{' '}
            {usage ? 'CLI USAGE' : 'NO DATA'}
          </span>
        </div>
      </div>

      <div className="ef-compose-row">
        <textarea
          ref={textareaRef}
          className="ef-textarea"
          rows={1}
          value={draft}
          placeholder={
            !hasKey
              ? '先在右侧 SETUP 保存 DeepSeek API Key'
              : !session
                ? '点击左侧「新建会话」后开始'
                : busy
                  ? '当前轮运行中，可点右侧停止'
                  : '输入任务，Enter 发送，Shift+Enter 换行'
          }
          disabled={!session || !hasKey}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return
            if (event.nativeEvent.isComposing) return
            event.preventDefault()
            submit()
          }}
        />
        {busy ? (
          <button
            type="button"
            className="ef-button ef-button-stop"
            onClick={() => void interrupt()}
          >
            停止
          </button>
        ) : (
          <button
            type="button"
            className="ef-button ef-button-primary"
            disabled={!ready || draft.trim().length === 0}
            onClick={submit}
          >
            发送
          </button>
        )}
      </div>

      <div className="ef-compose-foot">
        <span className="ef-label">ENTER 发送 │ SHIFT+ENTER 换行</span>
        <span className="ef-field">
          {draft.length} 字 <span className="ef-sep">│</span> {shortModel(session?.model)}
        </span>
      </div>
    </section>
  )
}
