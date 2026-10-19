import { useEffect, useState } from 'react'
import {
  EFFORT_OPTIONS,
  MODEL_OPTIONS,
  PERMISSION_OPTIONS,
  type EffortLevel,
  type VisiblePermissionMode
} from '@shared/events'
import { useRelayStore } from '../../store/useRelayStore'

type Status = { kind: 'idle' | 'ok' | 'error'; message: string } | null

export function SetupPanel(): React.JSX.Element {
  const bootstrap = useRelayStore((state) => state.bootstrap)
  const refreshBootstrap = useRelayStore((state) => state.refreshBootstrap)

  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState<EffortLevel>('high')
  const [permissionMode, setPermissionMode] = useState<VisiblePermissionMode>('default')
  const [workspace, setWorkspace] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  useEffect(() => {
    if (!bootstrap) return
    setBaseUrl(bootstrap.settings.baseUrl)
    setModel(bootstrap.settings.model)
    setEffort(bootstrap.settings.effort)
    setPermissionMode(bootstrap.settings.permissionMode)
    setWorkspace(bootstrap.settings.workspace)
  }, [bootstrap])

  if (!bootstrap) {
    return (
      <div className="ef-panel-empty">
        <div className="ef-label">LOADING</div>
        <p>正在读取设置…</p>
      </div>
    )
  }

  const hasKey = bootstrap.hasApiKey
  const storage = bootstrap.keyStorage
  const storageText =
    storage === 'safeStorage'
      ? '密钥已通过系统安全存储（Windows DPAPI / macOS Keychain）加密保存。'
      : storage === 'memory'
        ? '系统安全存储不可用：密钥只在本次运行中有效，退出后需重新输入。'
        : '尚未保存密钥。密钥不会写入仓库或日志。'

  const knownModels = MODEL_OPTIONS.map((entry) => entry.id)
  const modelOptions = knownModels.includes(model as (typeof knownModels)[number])
    ? MODEL_OPTIONS
    : [...MODEL_OPTIONS, { id: model, label: model, note: '自定义' }]

  const save = async (): Promise<void> => {
    setSaving(true)
    setStatus(null)
    try {
      if (apiKey.trim()) {
        const keyResult = await window.relay.setApiKey(apiKey.trim())
        if (!keyResult.ok) {
          setStatus({ kind: 'error', message: keyResult.error.message })
          return
        }
      }
      const result = await window.relay.saveSettings({
        baseUrl,
        model,
        effort,
        permissionMode,
        workspace
      })
      if (!result.ok) {
        setStatus({ kind: 'error', message: result.error.message })
        return
      }
      setApiKey('')
      await refreshBootstrap()
      setStatus({ kind: 'ok', message: '设置已保存。模型、effort 与权限模式在下次新建会话时生效。' })
    } finally {
      setSaving(false)
    }
  }

  const chooseWorkspace = async (): Promise<void> => {
    const result = await window.relay.chooseWorkspace()
    if (!result.ok) {
      setStatus({ kind: 'error', message: result.error.message })
      return
    }
    if (result.data) {
      setWorkspace(result.data)
      await refreshBootstrap()
    }
  }

  const clearKey = async (): Promise<void> => {
    if (!window.confirm('移除本机保存的 DeepSeek API Key？')) return
    const result = await window.relay.clearApiKey()
    if (!result.ok) {
      setStatus({ kind: 'error', message: result.error.message })
      return
    }
    await refreshBootstrap()
    setStatus({ kind: 'ok', message: '已移除保存的密钥。' })
  }

  return (
    <form
      className="ef-setup"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <section className="ef-form-section">
        <div className="ef-form-head">
          <span className="ef-label">CREDENTIAL</span>
          <span className="ef-form-title">DeepSeek 密钥</span>
        </div>
        <label className="ef-field-label" htmlFor="relay-key">
          API KEY
        </label>
        <input
          id="relay-key"
          className="ef-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          placeholder={hasKey ? '已保存，输入新值可替换' : 'sk-…'}
          onChange={(event) => setApiKey(event.target.value)}
        />
        <p className={`ef-hint${storage === 'memory' ? ' is-warn' : ''}`}>{storageText}</p>
        {hasKey ? (
          <button type="button" className="ef-text-button ef-danger" onClick={() => void clearKey()}>
            移除已保存的密钥
          </button>
        ) : null}
      </section>

      <section className="ef-form-section">
        <div className="ef-form-head">
          <span className="ef-label">ENDPOINT</span>
          <span className="ef-form-title">模型接入</span>
        </div>
        <label className="ef-field-label" htmlFor="relay-base">
          BASE URL
        </label>
        <input
          id="relay-base"
          className="ef-input ef-num"
          type="url"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
        />

        <label className="ef-field-label" htmlFor="relay-model">
          MODEL
        </label>
        <select
          id="relay-model"
          className="ef-input ef-select"
          value={model}
          onChange={(event) => setModel(event.target.value)}
        >
          {modelOptions.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label} — {entry.note}
            </option>
          ))}
        </select>

        <span className="ef-field-label">EFFORT</span>
        <div className="ef-segment" role="group" aria-label="Effort">
          {EFFORT_OPTIONS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`ef-segment-item${effort === entry.id ? ' is-active' : ''}`}
              aria-pressed={effort === entry.id}
              onClick={() => setEffort(entry.id)}
            >
              <span className="ef-label">{entry.label}</span>
            </button>
          ))}
        </div>

        <span className="ef-field-label">PERMISSION</span>
        <div className="ef-segment" role="group" aria-label="权限模式">
          {PERMISSION_OPTIONS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`ef-segment-item${permissionMode === entry.id ? ' is-active' : ''}`}
              aria-pressed={permissionMode === entry.id}
              onClick={() => setPermissionMode(entry.id)}
            >
              <span className="ef-label">{entry.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="ef-form-section">
        <div className="ef-form-head">
          <span className="ef-label">WORKSPACE</span>
          <span className="ef-form-title">工作区</span>
        </div>
        <div className="ef-workspace-row">
          <input className="ef-input ef-num" value={workspace} readOnly />
          <button
            type="button"
            className="ef-button ef-button-ghost"
            onClick={() => void chooseWorkspace()}
          >
            选择
          </button>
        </div>
      </section>

      {status ? (
        <p className={`ef-form-status ${status.kind === 'error' ? 'is-error' : 'is-ok'}`}>
          {status.message}
        </p>
      ) : null}

      <button type="submit" className="ef-button ef-button-primary ef-button-block" disabled={saving}>
        {saving ? '保存中…' : '保存设置'}
      </button>

      <p className="ef-panel-note">
        密钥只注入当前会话的 CLI 子进程；渲染层无法读取明文。修改模型、effort 或权限模式不会影响正在运行的会话。
      </p>
    </form>
  )
}
