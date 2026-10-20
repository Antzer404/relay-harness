import { useRelayStore } from '../store/useRelayStore'
import { baseName } from '../lib/format'
import {
  IconFolder,
  IconGear,
  IconMaximize,
  IconMinimize,
  IconProject,
  IconRestore,
  IconSidebar
} from './icons'
import type { SessionPhase } from '@shared/events'

const PHASE_LABEL: Record<SessionPhase, string> = {
  starting: '启动中',
  ready: '就绪',
  busy: '运行中',
  idle: '就绪',
  stopped: '已停止',
  error: '出错'
}

function WindowControls({ maximized }: { maximized: boolean }): React.JSX.Element {
  return (
    <div className="rly-window-controls">
      <button
        type="button"
        className="rly-window-btn"
        aria-label="最小化"
        onClick={() => void window.relay.windowControl('minimize')}
      >
        <IconMinimize />
      </button>
      <button
        type="button"
        className="rly-window-btn"
        aria-label={maximized ? '还原' : '最大化'}
        onClick={() => void window.relay.windowControl('toggle-maximize')}
      >
        {maximized ? <IconRestore /> : <IconMaximize />}
      </button>
      <button
        type="button"
        className="rly-window-btn rly-window-close"
        aria-label="关闭"
        onClick={() => void window.relay.windowControl('close')}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  )
}

export function TopBar(): React.JSX.Element {
  const bootstrap = useRelayStore((state) => state.bootstrap)
  const sessions = useRelayStore((state) => state.sessions)
  const activeId = useRelayStore((state) => state.activeId)
  const phase = useRelayStore((state) => state.phase)
  const sidebarOpen = useRelayStore((state) => state.sidebarOpen)
  const setSidebarOpen = useRelayStore((state) => state.setSidebarOpen)
  const devMode = useRelayStore((state) => state.devMode)
  const openDrawer = useRelayStore((state) => state.openDrawer)
  const chooseWorkspace = useRelayStore((state) => state.chooseWorkspace)
  const windowKind = useRelayStore((state) => state.windowKind)
  const project = useRelayStore((state) => state.project)
  const openProject = useRelayStore((state) => state.openProject)
  const maximized = useRelayStore((state) => state.maximized)

  const platform = bootstrap?.platform ?? 'unknown'
  const workspace =
    windowKind === 'project' ? project?.folder : bootstrap?.settings.workspace
  const activeTitle = sessions.find((record) => record.id === activeId)?.title

  return (
    <header className="rly-topbar" data-platform={platform}>
      <button
        type="button"
        className={`rly-icon-btn rly-topbar-btn${sidebarOpen ? ' is-on' : ''}`}
        aria-label={sidebarOpen ? '收起侧栏' : '展开侧栏'}
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        <IconSidebar />
      </button>

      <div className="rly-brand">
        <span className="rly-brand-mark" aria-hidden="true" />
        <span className="rly-brand-name">Relay</span>
      </div>

      <div className="rly-crumbs">
        {windowKind === 'project' ? (
          <span className="rly-workspace-btn is-static" title={workspace ?? ''}>
            <IconFolder />
            <span>{baseName(workspace)}</span>
          </span>
        ) : (
          <button
            type="button"
            className="rly-workspace-btn"
            title={workspace ?? '选择工作目录'}
            onClick={() => void chooseWorkspace()}
          >
            <IconFolder />
            <span>{baseName(workspace)}</span>
          </button>
        )}
        {windowKind === 'project' ? (
          <span className="rly-project-badge">Project</span>
        ) : null}
        {activeTitle ? (
          <>
            <span className="rly-crumb-sep">/</span>
            <span className="rly-crumb-title" title={activeTitle}>
              {activeTitle}
            </span>
          </>
        ) : null}
      </div>

      <div className="rly-top-actions">
        <span className={`rly-phase rly-phase-${phase}`}>
          <span className="rly-phase-dot" aria-hidden="true" />
          <span>{PHASE_LABEL[phase]}</span>
        </span>
        {windowKind === 'main' ? (
          <button
            type="button"
            className="rly-ghost-btn rly-project-btn"
            title="打开 Project 窗口"
            onClick={() => void openProject()}
          >
            <IconProject size={14} />
            Project
          </button>
        ) : null}
        {devMode ? (
          <button
            type="button"
            className="rly-ghost-btn"
            onClick={() => openDrawer('trace')}
          >
            事件
          </button>
        ) : null}
        <button
          type="button"
          className="rly-icon-btn rly-topbar-btn"
          aria-label="设置"
          onClick={() => openDrawer('settings')}
        >
          <IconGear />
        </button>
        {platform !== 'darwin' && platform !== 'unknown' ? (
          <WindowControls maximized={maximized} />
        ) : null}
      </div>
    </header>
  )
}
