import { useState } from 'react'
import {
  EFFORT_OPTIONS,
  MODEL_OPTIONS,
  PERMISSION_OPTIONS,
  THEME_OPTIONS,
  type EffortLevel,
  type ThemeMode,
  type VisiblePermissionMode,
  type WorkspaceConfigValues
} from '@shared/events'
import { useRelayStore } from '../store/useRelayStore'
import { IconClose } from './icons'

type Tab = 'general' | 'model' | 'workspace' | 'key' | 'about'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'general', label: '通用' },
  { id: 'model', label: '模型' },
  { id: 'workspace', label: '工作区' },
  { id: 'key', label: 'API Key' },
  { id: 'about', label: '关于' }
]

type Status = { kind: 'ok' | 'error'; message: string } | null

function sourceLabel(source: string | null): string {
  if (source === 'workspace') return '工作区配置'
  if (source === 'workspace-local') return '本机覆盖'
  if (source === 'app') return '应用默认'
  return '未设置'
}

export function SettingsDialog(): React.JSX.Element | null {
  const drawer = useRelayStore((state) => state.drawer)
  if (drawer !== 'settings') return null
  return <SettingsBody />
}

function SettingsBody(): React.JSX.Element | null {
  const bootstrap = useRelayStore((state) => state.bootstrap)
  const openDrawer = useRelayStore((state) => state.openDrawer)
  const saveSettings = useRelayStore((state) => state.saveSettings)
  const setThemeMode = useRelayStore((state) => state.setThemeMode)
  const setDevMode = useRelayStore((state) => state.setDevMode)
  const refreshBootstrap = useRelayStore((state) => state.refreshBootstrap)
  const chooseWorkspace = useRelayStore((state) => state.chooseWorkspace)
  const writeWorkspaceConfig = useRelayStore((state) => state.writeWorkspaceConfig)
  const clearWorkspaceConfig = useRelayStore((state) => state.clearWorkspaceConfig)
  const removeAllowedTool = useRelayStore((state) => state.removeAllowedTool)
  const windowKind = useRelayStore((state) => state.windowKind)
  const project = useRelayStore((state) => state.project)

  const [tab, setTab] = useState<Tab>('general')
  const [status, setStatus] = useState<Status>(null)
  const [saving, setSaving] = useState(false)

  const settings = bootstrap?.settings
  const effective = bootstrap?.effective
  const workspaceConfig = bootstrap?.workspaceConfig

  const [baseUrl, setBaseUrl] = useState(settings?.baseUrl ?? '')
  const [model, setModel] = useState(settings?.model ?? '')
  const [effort, setEffort] = useState<EffortLevel>(settings?.effort ?? 'high')
  const [permissionMode, setPermissionMode] = useState<VisiblePermissionMode>(
    settings?.permissionMode ?? 'default'
  )
  const [handoffThreshold, setHandoffThreshold] = useState(
    settings?.handoffThreshold ?? 70
  )
  const [apiKey, setApiKey] = useState('')

  const [wsModel, setWsModel] = useState(workspaceConfig?.values.model ?? '')
  const [wsEffort, setWsEffort] = useState<EffortLevel | ''>(
    workspaceConfig?.values.effort ?? ''
  )
  const [wsPermission, setWsPermission] = useState<VisiblePermissionMode | ''>(
    workspaceConfig?.values.permissionMode ?? ''
  )
  const [wsPrompt, setWsPrompt] = useState(workspaceConfig?.values.systemPromptAppend ?? '')

  if (!bootstrap || !settings || !effective) return null

  const knownModels = MODEL_OPTIONS.map((entry) => entry.id)
  const modelOptions = knownModels.includes(model as (typeof knownModels)[number])
    ? MODEL_OPTIONS
    : [...MODEL_OPTIONS, { id: model, label: model, note: '自定义' }]

  const close = (): void => openDrawer(null)

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setSaving(true)
    setStatus(null)
    try {
      await fn()
    } finally {
      setSaving(false)
    }
  }

  const saveModelSettings = (): Promise<void> =>
    run(async () => {
      const threshold = Math.min(90, Math.max(50, Math.round(handoffThreshold || 70)))
      const result = await saveSettings({
        baseUrl,
        model,
        effort,
        permissionMode,
        handoffThreshold: threshold
      })
      setStatus(
        result.ok
          ? { kind: 'ok', message: '已保存。模型与权限设置将在下次启动会话时生效。' }
          : { kind: 'error', message: result.error.message }
      )
    })

  const saveKey = (): Promise<void> =>
    run(async () => {
      if (apiKey.trim()) {
        const keyResult = await window.relay.setApiKey(apiKey.trim())
        if (!keyResult.ok) {
          setStatus({ kind: 'error', message: keyResult.error.message })
          return
        }
        setApiKey('')
        await refreshBootstrap()
        setStatus({ kind: 'ok', message: '密钥已保存。' })
      }
    })

  const clearKey = (): Promise<void> =>
    run(async () => {
      if (!window.confirm('移除本机保存的 DeepSeek API Key？')) return
      const result = await window.relay.clearApiKey()
      if (!result.ok) {
        setStatus({ kind: 'error', message: result.error.message })
        return
      }
      await refreshBootstrap()
      setStatus({ kind: 'ok', message: '已移除保存的密钥。' })
    })

  const saveWorkspace = (): Promise<void> =>
    run(async () => {
      const values: WorkspaceConfigValues = {}
      if (wsModel) values.model = wsModel
      if (wsEffort) values.effort = wsEffort
      if (wsPermission) values.permissionMode = wsPermission
      if (wsPrompt.trim()) values.systemPromptAppend = wsPrompt
      const result = await writeWorkspaceConfig(values)
      setStatus(
        result.ok
          ? { kind: 'ok', message: '工作区配置已写入 .relay/settings.json。' }
          : { kind: 'error', message: result.error.message }
      )
    })

  const clearWorkspace = (): Promise<void> =>
    run(async () => {
      if (!window.confirm('清除本工作区的 .relay 配置？应用默认设置将重新生效。')) return
      const result = await clearWorkspaceConfig()
      setStatus(
        result.ok
          ? { kind: 'ok', message: '已清除工作区配置。' }
          : { kind: 'error', message: result.error.message }
      )
      setWsModel('')
      setWsEffort('')
      setWsPermission('')
      setWsPrompt('')
    })

  const pickWorkspace = (): Promise<void> =>
    run(async () => {
      await chooseWorkspace()
      setWsModel('')
      setWsEffort('')
      setWsPermission('')
      setWsPrompt('')
    })

  const revokeTool = (rule: string): Promise<void> =>
    run(async () => {
      const result = await removeAllowedTool(rule)
      setStatus(
        result.ok
          ? { kind: 'ok', message: `已移除工具授权「${rule}」。` }
          : { kind: 'error', message: result.error.message }
      )
    })

  const storageText =
    bootstrap.keyStorage === 'safeStorage'
      ? '密钥通过系统安全存储加密保存在本机（Windows DPAPI / macOS Keychain）。'
      : bootstrap.keyStorage === 'memory'
        ? '系统安全存储不可用：密钥只在本次运行中有效，退出后需重新输入。'
        : '尚未保存密钥。密钥只注入 CLI 子进程，不会写入仓库或日志。'

  return (
    <div className="rly-scrim" onMouseDown={close}>
      <div
        className="rly-settings"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <aside className="rly-settings-nav">
          <div className="rly-settings-title">设置</div>
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`rly-settings-tab${tab === entry.id ? ' is-active' : ''}`}
              onClick={() => {
                setTab(entry.id)
                setStatus(null)
              }}
            >
              {entry.label}
            </button>
          ))}
        </aside>

        <div className="rly-settings-content">
          <button
            type="button"
            className="rly-icon-btn rly-settings-close"
            aria-label="关闭设置"
            onClick={close}
          >
            <IconClose />
          </button>

          {tab === 'general' ? (
            <section className="rly-form">
              <h2>通用</h2>
              <label className="rly-field-label">外观</label>
              <div className="rly-segment">
                {THEME_OPTIONS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={`rly-segment-item${
                      settings.theme === entry.id ? ' is-active' : ''
                    }`}
                    onClick={() => void setThemeMode(entry.id as ThemeMode)}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>

              <label className="rly-toggle-row">
                <div>
                  <span>开发者模式</span>
                  <p>在顶栏显示事件轨迹入口，用于排查运行时问题。</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.devMode}
                  className={`rly-switch${settings.devMode ? ' is-on' : ''}`}
                  onClick={() => void setDevMode(!settings.devMode)}
                >
                  <span />
                </button>
              </label>

              <label className="rly-field-label">长期记忆</label>
              <p className="rly-hint">
                每轮对话结束后自动整理项目记忆与用户画像；新记忆在下次启动会话时注入模型（约
                2000 tokens）。当前工作区 {bootstrap.memory.projectCount} 条，用户画像{' '}
                {bootstrap.memory.userCount} 条。
              </p>
              <div className="rly-effective">
                <div className="rly-effective-row">
                  <span>记忆库</span>
                  <span
                    className="rly-effective-value rly-memory-path"
                    title={bootstrap.memory.dir}
                  >
                    {bootstrap.memory.dir}
                  </span>
                </div>
                <div className="rly-effective-row">
                  <span>工作区镜像</span>
                  <span
                    className="rly-effective-value rly-memory-path"
                    title={bootstrap.memory.mirror}
                  >
                    {bootstrap.memory.mirror}
                  </span>
                </div>
              </div>
              <p className="rly-hint">
                记忆以 JSON 保存，可直接编辑；把条目的 <code>enabled</code> 改为{' '}
                <code>false</code> 即可停用。工作区镜像仅供阅读，手工修改会在下次整理时被覆盖。
              </p>
            </section>
          ) : null}

          {tab === 'model' ? (
            <section className="rly-form">
              <h2>模型</h2>
              <label className="rly-field-label" htmlFor="rly-base-url">
                接入地址
              </label>
              <input
                id="rly-base-url"
                className="rly-input"
                type="url"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
              />

              <label className="rly-field-label" htmlFor="rly-default-model">
                默认模型
              </label>
              <select
                id="rly-default-model"
                className="rly-input"
                value={model}
                onChange={(event) => setModel(event.target.value)}
              >
                {modelOptions.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label} — {entry.note}
                  </option>
                ))}
              </select>

              <label className="rly-field-label">思考强度</label>
              <div className="rly-segment">
                {EFFORT_OPTIONS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={`rly-segment-item${effort === entry.id ? ' is-active' : ''}`}
                    onClick={() => setEffort(entry.id)}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>

              <label className="rly-field-label">默认权限</label>
              <div className="rly-segment is-wrap">
                {PERMISSION_OPTIONS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={`rly-segment-item${
                      permissionMode === entry.id ? ' is-active' : ''
                    }`}
                    title={entry.note}
                    onClick={() => setPermissionMode(entry.id)}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>

              <label className="rly-field-label" htmlFor="rly-handoff-threshold">
                交接提醒阈值（%）
              </label>
              <input
                id="rly-handoff-threshold"
                className="rly-input"
                type="number"
                min={50}
                max={90}
                step={1}
                value={handoffThreshold}
                onChange={(event) => setHandoffThreshold(Number(event.target.value))}
              />
              <p className="rly-hint">
                上下文填充率达到该值时，输入框上方会提示交接。要低于 CLI
                自动压缩的 75%，否则会先被压缩。
              </p>

              <p className="rly-hint">
                工作区可以在 <code>.relay/settings.json</code> 中覆盖这些默认值。
              </p>

              <button
                type="button"
                className="rly-btn rly-btn-primary"
                disabled={saving}
                onClick={() => void saveModelSettings()}
              >
                {saving ? '保存中…' : '保存默认设置'}
              </button>
            </section>
          ) : null}

          {tab === 'workspace' ? (
            <section className="rly-form">
              <h2>工作区</h2>

              <label className="rly-field-label">当前目录</label>
              <div className="rly-inline">
                <input
                  className="rly-input"
                  value={windowKind === 'project' ? (project?.folder ?? '') : settings.workspace}
                  readOnly
                />
                {windowKind === 'main' ? (
                  <button type="button" className="rly-btn" onClick={() => void pickWorkspace()}>
                    选择
                  </button>
                ) : null}
              </div>
              {windowKind === 'project' ? (
                <p className="rly-hint">
                  Project 窗口的工作文件夹在打开时固定；团队阵容可在该目录的{' '}
                  <code>.relay/agents.json</code> 中调整。
                </p>
              ) : null}

              <div className="rly-effective">
                <div className="rly-effective-row">
                  <span>模型</span>
                  <span className="rly-effective-value">
                    {effective.model}
                    <em>{sourceLabel(effective.sources.model)}</em>
                  </span>
                </div>
                <div className="rly-effective-row">
                  <span>思考强度</span>
                  <span className="rly-effective-value">
                    {effective.effort.toUpperCase()}
                    <em>{sourceLabel(effective.sources.effort)}</em>
                  </span>
                </div>
                <div className="rly-effective-row">
                  <span>权限</span>
                  <span className="rly-effective-value">
                    {effective.permissionMode}
                    <em>{sourceLabel(effective.sources.permissionMode)}</em>
                  </span>
                </div>
                <div className="rly-effective-row">
                  <span>追加提示</span>
                  <span className="rly-effective-value">
                    {effective.systemPromptAppend ? '已设置' : '无'}
                    <em>{sourceLabel(effective.sources.systemPromptAppend)}</em>
                  </span>
                </div>
              </div>

              <label className="rly-field-label">工作区覆盖</label>
              <select
                className="rly-input"
                value={wsModel}
                onChange={(event) => setWsModel(event.target.value)}
              >
                <option value="">模型：跟随默认</option>
                {MODEL_OPTIONS.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>

              <div className="rly-inline">
                <select
                  className="rly-input"
                  value={wsEffort}
                  onChange={(event) => setWsEffort(event.target.value as EffortLevel | '')}
                >
                  <option value="">思考强度：跟随默认</option>
                  {EFFORT_OPTIONS.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
                <select
                  className="rly-input"
                  value={wsPermission}
                  onChange={(event) =>
                    setWsPermission(event.target.value as VisiblePermissionMode | '')
                  }
                >
                  <option value="">权限：跟随默认</option>
                  {PERMISSION_OPTIONS.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </div>

              <label className="rly-field-label" htmlFor="rly-ws-prompt">
                追加系统提示
              </label>
              <textarea
                id="rly-ws-prompt"
                className="rly-input rly-textarea-small"
                rows={3}
                placeholder="例如：这个仓库使用 pnpm，提交前先跑 typecheck。"
                value={wsPrompt}
                onChange={(event) => setWsPrompt(event.target.value)}
              />

              <p className="rly-hint">
                配置文件：<code>{workspaceConfig?.path ?? '.relay/settings.json'}</code>
              </p>
              {workspaceConfig?.error ? (
                <p className="rly-hint is-warn">{workspaceConfig.error}</p>
              ) : null}
              {(workspaceConfig?.values.allowedTools ?? []).length > 0 ? (
                <div className="rly-allowed-tools">
                  <span className="rly-field-label">已允许的工具</span>
                  <ul>
                    {workspaceConfig?.values.allowedTools?.map((rule) => (
                      <li key={rule}>
                        <code>{rule}</code>
                        <button
                          type="button"
                          className="rly-rule-remove"
                          disabled={saving}
                          onClick={() => void revokeTool(rule)}
                        >
                          移除
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="rly-hint">
                    授权按工具整体生效：「WebFetch」覆盖所有网站，「Write」覆盖所有文件。旧版按网站/文件
                    写入的规则会自动归并为工具名；累积记录保存在 settings.local.json。
                  </p>
                </div>
              ) : null}

              <div className="rly-inline">
                <button
                  type="button"
                  className="rly-btn rly-btn-primary"
                  disabled={saving}
                  onClick={() => void saveWorkspace()}
                >
                  保存工作区配置
                </button>
                <button
                  type="button"
                  className="rly-btn rly-btn-ghost"
                  disabled={saving}
                  onClick={() => void clearWorkspace()}
                >
                  清除配置
                </button>
              </div>
            </section>
          ) : null}

          {tab === 'key' ? (
            <section className="rly-form">
              <h2>API Key</h2>
              <label className="rly-field-label" htmlFor="rly-api-key">
                DeepSeek API Key
              </label>
              <input
                id="rly-api-key"
                className="rly-input"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                placeholder={bootstrap.hasApiKey ? '已保存，输入新值可替换' : 'sk-…'}
                onChange={(event) => setApiKey(event.target.value)}
              />
              <p className={`rly-hint${bootstrap.keyStorage === 'memory' ? ' is-warn' : ''}`}>
                {storageText}
              </p>
              <div className="rly-inline">
                <button
                  type="button"
                  className="rly-btn rly-btn-primary"
                  disabled={saving || !apiKey.trim()}
                  onClick={() => void saveKey()}
                >
                  保存密钥
                </button>
                {bootstrap.hasApiKey ? (
                  <button
                    type="button"
                    className="rly-btn rly-btn-ghost"
                    disabled={saving}
                    onClick={() => void clearKey()}
                  >
                    移除密钥
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}

          {tab === 'about' ? (
            <section className="rly-form">
              <h2>关于</h2>
              <div className="rly-about">
                <div>
                  <span>Relay 接力</span>
                  <em>v{bootstrap.appVersion}</em>
                </div>
                <div>
                  <span>Electron</span>
                  <em>{bootstrap.electronVersion}</em>
                </div>
                <div>
                  <span>Agent SDK</span>
                  <em>{bootstrap.sdk.version}</em>
                </div>
                <div>
                  <span>Claude Code CLI</span>
                  <em>{bootstrap.sdk.cliVersion ?? '—'}</em>
                </div>
                <div>
                  <span>平台</span>
                  <em>
                    {bootstrap.platform} · {bootstrap.arch}
                  </em>
                </div>
              </div>
              <p className="rly-hint">
                会话记录保存在应用数据目录的 sessions 文件夹中；工作区配置保存在当前目录的
                .relay 文件夹。
              </p>
            </section>
          ) : null}

          {status ? (
            <p className={`rly-form-status is-${status.kind}`}>{status.message}</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
