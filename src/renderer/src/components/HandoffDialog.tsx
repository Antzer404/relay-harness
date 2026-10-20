import { useEffect, useState } from 'react'
import { useRelayStore } from '../store/useRelayStore'
import { relativeTime } from '../lib/format'
import { IconClose, IconRelay } from './icons'

/**
 * Preview/edit dialog for a generated handoff document. Confirming creates the
 * follow-up session and opens it; the source session stays untouched.
 */
export function HandoffDialog(): React.JSX.Element | null {
  const open = useRelayStore((state) => state.handoffOpen)
  const status = useRelayStore((state) => state.handoffStatus)
  const doc = useRelayStore((state) => state.handoffDoc)
  const error = useRelayStore((state) => state.handoffError)
  const close = useRelayStore((state) => state.closeHandoff)
  const regenerate = useRelayStore((state) => state.regenerateHandoff)
  const accept = useRelayStore((state) => state.acceptHandoff)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    setDraft(doc?.markdown ?? '')
  }, [doc?.id, doc?.markdown])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

  const generating = status === 'generating'
  // Keep the editable draft visible if a later accept/regen attempt failed.
  const ready = Boolean(doc) && !generating
  const canAccept = ready && draft.trim().length > 0

  return (
    <div className="rly-scrim" onMouseDown={() => close()}>
      <section
        className="rly-handoff"
        role="dialog"
        aria-modal="true"
        aria-label="交接文档"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="rly-handoff-head">
          <div className="rly-handoff-title">
            <span className="rly-handoff-mark" aria-hidden="true">
              <IconRelay size={15} />
            </span>
            <div>
              <h2>交接文档</h2>
              <p className="rly-hint">
                {doc
                  ? `来自「${doc.fromTitle}」 · ${relativeTime(doc.createdAt)}${
                      doc.contextPercent === null
                        ? ''
                        : ` · 上下文 ${doc.contextPercent.toFixed(1)}%`
                    }`
                  : '从当前会话的完整记录生成'}
              </p>
            </div>
          </div>
          <button type="button" className="rly-icon-btn" aria-label="关闭" onClick={close}>
            <IconClose />
          </button>
        </header>

        <div className="rly-handoff-body">
          {generating ? (
            <div className="rly-handoff-state">
              <span className="rly-spinner" aria-hidden="true" />
              <div>
                <p>正在根据会话记录生成交接文档…</p>
                <p className="rly-hint">只读取已保存的事件，不会影响当前会话。</p>
              </div>
            </div>
          ) : null}

          {status === 'error' ? (
            <div className="rly-handoff-state is-error" role="alert">
              <div>
                <p>生成失败</p>
                <p className="rly-hint">{error ?? '未知错误'}</p>
              </div>
            </div>
          ) : null}

          {ready ? (
            <textarea
              className="rly-handoff-editor"
              value={draft}
              spellCheck={false}
              onChange={(event) => setDraft(event.target.value)}
              aria-label="交接文档内容"
            />
          ) : null}

          {ready ? (
            <p className="rly-hint">
              可以直接编辑。确认后会新建会话，并把这份文档作为背景注入；当前会话保留在侧栏。
            </p>
          ) : null}
        </div>

        <footer className="rly-handoff-foot">
          <button
            type="button"
            className="rly-btn rly-btn-ghost"
            disabled={generating}
            onClick={() => void regenerate()}
          >
            {generating ? '生成中…' : '重新生成'}
          </button>
          <div className="rly-handoff-actions">
            <button type="button" className="rly-btn" onClick={close}>
              取消
            </button>
            <button
              type="button"
              className="rly-btn rly-btn-primary"
              disabled={!canAccept}
              onClick={() => void accept(draft)}
            >
              确认并开始新会话
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
