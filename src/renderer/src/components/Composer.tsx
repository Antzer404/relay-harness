import { useEffect, useRef, useState } from 'react'
import { PERMISSION_OPTIONS, type VisiblePermissionMode } from '@shared/events'
import { useRelayStore } from '../store/useRelayStore'
import { IconChevron, IconRelay, IconSend, IconStop } from './icons'

const MODE_SHORT: Record<VisiblePermissionMode, string> = {
  default: '每次询问',
  plan: '仅规划',
  acceptEdits: '自动接受'
}

function ModeSwitcher(): React.JSX.Element {
  const mode = useRelayStore((state) => state.permissionMode)
  const apply = useRelayStore((state) => state.applyPermissionMode)
  const live = useRelayStore((state) => Boolean(state.current))
  const modeSource = useRelayStore((state) => state.bootstrap?.effective.sources.permissionMode)
  const [open, setOpen] = useState(false)
  const [align, setAlign] = useState<'left' | 'right'>('left')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const hint = live
    ? '切换立即作用于当前会话'
    : modeSource && modeSource !== 'app'
      ? '当前没有运行中的会话；工作区配置覆盖了权限模式'
      : '当前没有运行中的会话，切换会保存为应用默认'

  const choose = (next: VisiblePermissionMode): void => {
    setOpen(false)
    if (next === mode && live) return
    void apply(next)
  }

  const toggle = (): void => {
    if (!open) {
      // Flip to the right edge of the chip when the popover would overflow.
      const rect = rootRef.current?.getBoundingClientRect()
      setAlign(rect && rect.left + 304 > window.innerWidth - 12 ? 'right' : 'left')
    }
    setOpen(!open)
  }

  return (
    <div className="rly-mode" ref={rootRef}>
      <button
        type="button"
        className={`rly-mode-chip is-${mode}${open ? ' is-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`权限模式：${MODE_SHORT[mode]}`}
        onClick={toggle}
      >
        <span className="rly-mode-dot" aria-hidden="true" />
        <span>{MODE_SHORT[mode]}</span>
        <IconChevron size={12} />
      </button>

      {open ? (
        <div className={`rly-mode-pop is-${align}`} role="menu" aria-label="权限模式">
          <div className="rly-mode-pop-head">权限模式</div>
          {PERMISSION_OPTIONS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="menuitemradio"
              aria-checked={entry.id === mode}
              className={`rly-mode-option${entry.id === mode ? ' is-active' : ''}`}
              onClick={() => choose(entry.id)}
            >
              <span className="rly-mode-option-main">
                <span className="rly-mode-option-label">{entry.label}</span>
                <span className="rly-mode-option-note">{entry.note}</span>
              </span>
              <span className="rly-mode-option-check" aria-hidden="true">
                {entry.id === mode ? '✓' : ''}
              </span>
            </button>
          ))}
          <p className="rly-mode-pop-hint">{hint}</p>
        </div>
      ) : null}
    </div>
  )
}

export function Composer(): React.JSX.Element {
  const draft = useRelayStore((state) => state.draft)
  const setDraft = useRelayStore((state) => state.setDraft)
  const send = useRelayStore((state) => state.send)
  const interrupt = useRelayStore((state) => state.interrupt)
  const phase = useRelayStore((state) => state.phase)
  const queued = useRelayStore((state) => state.queued)
  const hasKey = useRelayStore((state) => state.bootstrap?.hasApiKey ?? false)
  const windowKind = useRelayStore((state) => state.windowKind)
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const up = (): void => setOnline(true)
    const down = (): void => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  const usage = useRelayStore((state) => state.usage)
  const threshold = useRelayStore(
    (state) => state.bootstrap?.settings.handoffThreshold ?? 70
  )
  const current = useRelayStore((state) => state.current)
  const handoffStatus = useRelayStore((state) => state.handoffStatus)
  const openHandoff = useRelayStore((state) => state.openHandoff)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const busy = phase === 'busy' || phase === 'starting'
  const canSend = hasKey && draft.trim().length > 0
  const pressure = usage !== null && usage.percent >= threshold
  const handoffGenerating = handoffStatus === 'generating'

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
      // Escape inside the mode menu only closes the menu.
      if (document.querySelector('.rly-mode-pop')) return
      if (state.phase !== 'busy' && state.phase !== 'starting') return
      event.preventDefault()
      void interrupt()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [interrupt])

  const submit = (interrupt = false): void => {
    if (!canSend) return
    void send(draft, { interrupt })
  }

  const placeholder = !hasKey
    ? '先在设置中保存 DeepSeek API Key'
    : busy
      ? '运行中 · Enter 插入本轮 · Ctrl+Enter 立即打断 · Esc 停止'
      : windowKind === 'project'
        ? '向 Leader 下达目标，Enter 发送，Shift+Enter 换行'
        : '输入任务，Enter 发送，Shift+Enter 换行'

  return (
    <div className="rly-composer-dock">
      {!online ? (
        <div className="rly-net-alert" role="status">
          <span>网络已断开，消息可能无法送达。恢复后点错误卡片上的「重试上一条」即可。</span>
        </div>
      ) : null}
      {pressure && usage ? (
        <div className="rly-context-alert" role="status">
          <span className="rly-context-alert-text">
            上下文已用 {usage.percent.toFixed(0)}%，接近自动压缩
            <em>（{threshold}% 提醒）</em>
          </span>
          <button
            type="button"
            className="rly-context-alert-btn"
            disabled={busy || handoffGenerating}
            onClick={() => void openHandoff()}
          >
            <IconRelay size={13} />
            <span>{handoffGenerating ? '生成中…' : '交接'}</span>
          </button>
        </div>
      ) : null}
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
            submit(event.ctrlKey || event.metaKey)
          }}
        />
        <div className="rly-composer-bar">
          <div className="rly-composer-left">
            <ModeSwitcher />
            <span className="rly-composer-hint">
              {queued.length > 0
                ? `已排队 ${queued.length} 条`
                : busy
                  ? 'Enter 插入本轮 · Ctrl+Enter 打断'
                  : 'Enter 发送 · Shift+Enter 换行'}
            </span>
          </div>
          <div className="rly-composer-buttons">
            {current ? (
              <button
                type="button"
                className={`rly-handoff-btn${pressure ? ' is-alert' : ''}`}
                title="把当前会话整理成交接文档，在新会话中继续"
                onClick={() => void openHandoff()}
              >
                <IconRelay size={14} />
                <span>{handoffGenerating ? '生成中' : '交接'}</span>
              </button>
            ) : null}
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
                aria-label={busy ? '插入本轮' : '发送'}
                title={busy ? '插入本轮（Ctrl+Enter 立即打断）' : '发送'}
                onClick={() => submit()}
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
