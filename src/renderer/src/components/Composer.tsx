import { useEffect, useRef } from 'react'
import { useRelayStore } from '../store/useRelayStore'
import { IconSend, IconStop } from './icons'

export function Composer(): React.JSX.Element {
  const draft = useRelayStore((state) => state.draft)
  const setDraft = useRelayStore((state) => state.setDraft)
  const send = useRelayStore((state) => state.send)
  const interrupt = useRelayStore((state) => state.interrupt)
  const phase = useRelayStore((state) => state.phase)
  const queued = useRelayStore((state) => state.queued)
  const hasKey = useRelayStore((state) => state.bootstrap?.hasApiKey ?? false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const busy = phase === 'busy' || phase === 'starting'
  const canSend = hasKey && draft.trim().length > 0

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  useEffect(() => {
    const node = textareaRef.current
    if (!node) return
    node.style.height = '0px'
    node.style.height = `${Math.min(node.scrollHeight, 200)}px`
  }, [draft])

  useEffect(() => {
    const focus = (): void => textareaRef.current?.focus()
    window.addEventListener('relay:focus-composer', focus)
    return () => window.removeEventListener('relay:focus-composer', focus)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      const state = useRelayStore.getState()
      if (state.drawer) return
      if (state.phase !== 'busy' && state.phase !== 'starting') return
      event.preventDefault()
      void interrupt()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [interrupt])

  const submit = (): void => {
    if (!canSend) return
    void send(draft)
  }

  const placeholder = !hasKey
    ? '先在设置中保存 DeepSeek API Key'
    : busy
      ? '运行中，Enter 可把消息加入队列'
      : '输入任务，Enter 发送，Shift+Enter 换行'

  return (
    <div className="rly-composer-dock">
      <div className="rly-composer">
        <textarea
          ref={textareaRef}
          className="rly-textarea"
          rows={1}
          value={draft}
          placeholder={placeholder}
          disabled={!hasKey}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return
            if (event.nativeEvent.isComposing) return
            event.preventDefault()
            submit()
          }}
        />
        <div className="rly-composer-bar">
          <span className="rly-composer-hint">
            {queued.length > 0
              ? `已排队 ${queued.length} 条`
              : busy
                ? '模型正在工作'
                : 'Enter 发送 · Shift+Enter 换行'}
          </span>
          <div className="rly-composer-buttons">
            {busy ? (
              <button
                type="button"
                className="rly-stop-btn"
                onClick={() => void interrupt()}
              >
                <IconStop />
                <span>停止</span>
              </button>
            ) : null}
            {!busy || canSend ? (
              <button
                type="button"
                className="rly-send-btn"
                disabled={!canSend}
                aria-label={busy ? '加入队列' : '发送'}
                onClick={submit}
              >
                <IconSend />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
