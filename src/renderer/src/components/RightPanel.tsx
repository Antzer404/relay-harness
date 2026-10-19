import { useRelayStore, type RightTab } from '../store/useRelayStore'
import { ContextPanel } from './panels/ContextPanel'
import { TracePanel } from './panels/TracePanel'
import { SetupPanel } from './panels/SetupPanel'

const TABS: Array<{ id: RightTab; latin: string; cn: string }> = [
  { id: 'context', latin: 'CONTEXT', cn: '上下文' },
  { id: 'trace', latin: 'TRACE', cn: '事件' },
  { id: 'setup', latin: 'SETUP', cn: '设置' }
]

export function RightPanel(): React.JSX.Element | null {
  const open = useRelayStore((state) => state.rightOpen)
  const tab = useRelayStore((state) => state.rightTab)
  const setTab = useRelayStore((state) => state.setRightTab)
  const toggleRight = useRelayStore((state) => state.toggleRight)

  if (!open) return null

  return (
    <aside className="ef-panel">
      <div className="ef-panel-head">
        <div>
          <div className="ef-eyebrow">
            <span className="ef-label">INSPECTOR</span>
          </div>
          <h2 className="ef-title-cn">检查器</h2>
        </div>
        <button type="button" className="ef-cmd-button ef-panel-close" onClick={toggleRight}>
          CLOSE
        </button>
      </div>

      <div className="ef-tabs" role="tablist" aria-label="检查器">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={`ef-tab${tab === entry.id ? ' is-active' : ''}`}
            onClick={() => setTab(entry.id)}
          >
            <span className="ef-label">{entry.latin}</span>
            <span>{entry.cn}</span>
          </button>
        ))}
      </div>

      <div className="ef-panel-body">
        {tab === 'context' ? <ContextPanel /> : null}
        {tab === 'trace' ? <TracePanel /> : null}
        {tab === 'setup' ? <SetupPanel /> : null}
      </div>
    </aside>
  )
}
