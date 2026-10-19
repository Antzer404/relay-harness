import { useRelayStore } from '../store/useRelayStore'
import { baseName, shortModel } from '../lib/format'
import type { SessionPhase } from '@shared/events'

const PHASE_LABEL: Record<SessionPhase, string> = {
  starting: '启动中',
  ready: '就绪',
  busy: '运行中',
  idle: '空闲',
  stopped: '已停止',
  error: '错误'
}

export function CommandBar(): React.JSX.Element {
  const bootstrap = useRelayStore((state) => state.bootstrap)
  const session = useRelayStore((state) => state.session)
  const phase = useRelayStore((state) => state.phase)
  const theme = useRelayStore((state) => state.theme)
  const toggleTheme = useRelayStore((state) => state.toggleTheme)
  const toggleRight = useRelayStore((state) => state.toggleRight)
  const setRightTab = useRelayStore((state) => state.setRightTab)

  const workspace = session?.cwd ?? bootstrap?.settings.workspace ?? null
  const model = session?.model ?? bootstrap?.settings.model ?? null
  const effort = bootstrap?.settings.effort ?? 'high'

  return (
    <header className="ef-commandbar">
      <div className="ef-brand">
        <span className="ef-brand-mark" aria-hidden="true" />
        <span className="ef-brand-latin">RELAY</span>
        <span className="ef-brand-cn">接力</span>
      </div>

      <div className="ef-cmd-fields">
        <div className="ef-cmd-field">
          <span className="ef-label">WORKSPACE</span>
          <span className="ef-cmd-value" title={workspace ?? undefined}>
            {baseName(workspace)}
          </span>
        </div>
        <div className="ef-cmd-field">
          <span className="ef-label">MODEL</span>
          <span className="ef-cmd-value ef-num">{shortModel(model)}</span>
        </div>
        <div className="ef-cmd-field">
          <span className="ef-label">EFFORT</span>
          <span className="ef-cmd-value ef-num">{effort.toUpperCase()}</span>
        </div>
      </div>

      <div className="ef-cmd-actions">
        <span className={`ef-phase ef-phase-${phase}`}>
          <span className="ef-phase-dot" aria-hidden="true" />
          <span className="ef-label">{PHASE_LABEL[phase]}</span>
        </span>
        <button type="button" className="ef-cmd-button" onClick={() => setRightTab('setup')}>
          SETUP
        </button>
        <button type="button" className="ef-cmd-button" onClick={toggleTheme}>
          {theme === 'light' ? 'DARK' : 'LIGHT'}
        </button>
        <button type="button" className="ef-cmd-button" onClick={toggleRight} aria-label="切换右侧面板">
          PANEL
        </button>
        <span className="ef-cmd-version ef-num">v{bootstrap?.appVersion ?? '—'}</span>
      </div>
    </header>
  )
}
