import { useState } from 'react'
import { useRelayStore } from '../store/useRelayStore'
import { baseName, relativeTime } from '../lib/format'
import { IconPencil, IconPlus, IconTrash } from './icons'

export function Sidebar(): React.JSX.Element {
  const open = useRelayStore((state) => state.sidebarOpen)
  const sessions = useRelayStore((state) => state.sessions)
  const activeId = useRelayStore((state) => state.activeId)
  const current = useRelayStore((state) => state.current)
  const bootstrap = useRelayStore((state) => state.bootstrap)
  const phase = useRelayStore((state) => state.phase)
  const newSession = useRelayStore((state) => state.newSession)
  const openSession = useRelayStore((state) => state.openSession)
  const renameSession = useRelayStore((state) => state.renameSession)
  const deleteSession = useRelayStore((state) => state.deleteSession)
  const openDrawer = useRelayStore((state) => state.openDrawer)

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const hasKey = bootstrap?.hasApiKey ?? false
  const busy = phase === 'busy' || phase === 'starting'

  const commitRename = async (): Promise<void> => {
    if (!renamingId) return
    const title = renameValue.trim()
    const id = renamingId
    setRenamingId(null)
    if (!title) return
    await renameSession(id, title)
  }

  return (
    <aside className={`rly-sidebar${open ? '' : ' is-collapsed'}`} aria-hidden={!open}>
      <div className="rly-sidebar-inner">
        <button
          type="button"
          className="rly-new-session"
          disabled={!hasKey || busy}
          title={busy ? '当前会话运行中' : '新建会话'}
          onClick={() => void newSession()}
        >
          <IconPlus />
          <span>新会话</span>
        </button>

        <div className="rly-sidebar-label">会话</div>

        <nav className="rly-session-list">
          {sessions.length === 0 ? (
            <p className="rly-session-empty">
              {hasKey
                ? '还没有会话。直接在下方输入任务，或点「新会话」开始记录。'
                : '先在设置中保存 API Key。'}
            </p>
          ) : (
            sessions.map((record) => {
              const active = record.id === activeId
              return (
                <div
                  key={record.id}
                  className={`rly-session${active ? ' is-active' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => void openSession(record.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void openSession(record.id)
                  }}
                >
                  {renamingId === record.id ? (
                    <input
                      className="rly-rename-input"
                      autoFocus
                      value={renameValue}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onBlur={() => void commitRename()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void commitRename()
                        if (event.key === 'Escape') setRenamingId(null)
                      }}
                    />
                  ) : (
                    <div className="rly-session-main">
                      <span className="rly-session-title">{record.title}</span>
                      <span className="rly-session-meta">
                        {baseName(record.cwd)} · {relativeTime(record.updatedAt)}
                      </span>
                    </div>
                  )}
                  <div className="rly-session-actions">
                    <button
                      type="button"
                      aria-label="重命名"
                      onClick={(event) => {
                        event.stopPropagation()
                        setRenamingId(record.id)
                        setRenameValue(record.title)
                      }}
                    >
                      <IconPencil />
                    </button>
                    <button
                      type="button"
                      aria-label="删除"
                      onClick={(event) => {
                        event.stopPropagation()
                        if (window.confirm(`删除会话「${record.title}」？记录将从本机移除。`)) {
                          void deleteSession(record.id)
                        }
                      }}
                    >
                      <IconTrash />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </nav>

        <div className="rly-sidebar-foot">
          {current ? (
            <span className="rly-sidebar-session-state">
              {busy ? '正在工作' : '当前会话已就绪'} · {baseName(current.cwd)}
            </span>
          ) : (
            <button
              type="button"
              className="rly-sidebar-link"
              onClick={() => openDrawer('settings')}
            >
              {hasKey ? '打开设置' : '配置 API Key'}
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
