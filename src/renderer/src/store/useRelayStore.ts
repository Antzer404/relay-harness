import { create } from 'zustand'
import type {
  BootstrapState,
  EffortLevel,
  HarnessEvent,
  IpcResult,
  PermissionDecisionKind,
  RelayEvent,
  RelaySettings,
  SessionPhase,
  SessionRecord,
  SessionSummary,
  ThemeMode,
  VisiblePermissionMode,
  WorkspaceConfigValues
} from '@shared/events'
import type {
  ErrorItem,
  NoticeItem,
  PermissionItem,
  TextItem,
  ThinkingItem,
  TimelineItem,
  ToolItem,
  UserItem
} from '@shared/timeline'

export type {
  ErrorItem,
  NoticeItem,
  PermissionItem,
  TextItem,
  ThinkingItem,
  TimelineItem,
  ToolItem,
  UserItem
}

export type RightDrawer = 'settings' | 'trace' | null

let counter = 0
let initStarted = false
const nextId = (prefix: string): string => {
  counter += 1
  return `${prefix}-${counter}`
}

export interface RelayState {
  bootstrapped: boolean
  fatal: string | null
  bootstrap: BootstrapState | null
  sessions: SessionRecord[]
  current: SessionSummary | null
  activeId: string | null
  phase: SessionPhase
  items: TimelineItem[]
  trace: RelayEvent[]
  queued: string[]
  draft: string
  drawer: RightDrawer
  themeMode: ThemeMode
  devMode: boolean
  sidebarOpen: boolean
  maximized: boolean
  sending: boolean

  init: () => Promise<void>
  handleEvent: (envelope: RelayEvent) => void
  refreshBootstrap: () => Promise<void>
  refreshSessions: () => Promise<void>
  setDraft: (value: string) => void
  send: (text: string) => Promise<void>
  flushQueue: () => Promise<void>
  interrupt: () => Promise<void>
  retryLast: () => Promise<void>
  newSession: () => Promise<void>
  openSession: (sessionId: string) => Promise<void>
  renameSession: (sessionId: string, title: string) => Promise<IpcResult<SessionRecord>>
  deleteSession: (sessionId: string) => Promise<void>
  respondPermission: (
    requestId: string,
    decision: PermissionDecisionKind,
    message?: string
  ) => Promise<void>
  openDrawer: (drawer: RightDrawer) => void
  setThemeMode: (mode: ThemeMode) => Promise<void>
  setDevMode: (enabled: boolean) => Promise<void>
  setSidebarOpen: (open: boolean) => void
  setMaximized: (maximized: boolean) => void
  chooseWorkspace: () => Promise<void>
  saveSettings: (patch: Partial<RelaySettings>) => Promise<IpcResult<RelaySettings>>
  writeWorkspaceConfig: (
    values: WorkspaceConfigValues
  ) => Promise<IpcResult<BootstrapState>>
  clearWorkspaceConfig: () => Promise<IpcResult<BootstrapState>>
}

// --------------------------------------------------------------------- items

function addItem(items: TimelineItem[], item: TimelineItem): TimelineItem[] {
  return [...items, item]
}

function closeRunningTools(items: TimelineItem[], message: string): TimelineItem[] {
  let changed = false
  const next = items.map((item) => {
    if (item.kind !== 'tool' || item.status !== 'running') return item
    changed = true
    return {
      ...item,
      status: 'error' as const,
      output: item.output ?? message
    }
  })
  return changed ? next : items
}

function replaceLastOpen(
  items: TimelineItem[],
  kind: 'text' | 'thinking',
  update: (item: TextItem | ThinkingItem) => TextItem | ThinkingItem
): TimelineItem[] {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item && item.kind === kind && !item.done) {
      const next = [...items]
      next[index] = update(item as TextItem | ThinkingItem)
      return next
    }
    if (item && item.kind !== kind) break
  }
  return items
}

function closeStreams(items: TimelineItem[], toolMessage: string): TimelineItem[] {
  return closeRunningTools(
    items.map((item) => {
      if (item.kind === 'text' && !item.done) return { ...item, done: true }
      if (item.kind === 'thinking' && !item.done) return { ...item, done: true }
      return item
    }),
    toolMessage
  )
}

/** Applies one runtime event to the timeline; used for live and replayed events. */
function reduceItems(items: TimelineItem[], event: HarnessEvent, ts: number): TimelineItem[] {
  switch (event.type) {
    case 'user_message':
      return addItem(items, {
        kind: 'user',
        id: nextId('user'),
        text: event.text,
        at: ts
      })

    case 'text_delta': {
      const next = replaceLastOpen(items, 'text', (item) => ({
        ...(item as TextItem),
        text: (item as TextItem).text + event.text
      }))
      if (next !== items) return next
      return addItem(items, {
        kind: 'text',
        id: nextId('text'),
        text: event.text,
        done: false
      })
    }

    case 'text_done': {
      if (!event.text) return items
      const next = replaceLastOpen(items, 'text', (item) => ({
        ...(item as TextItem),
        text: event.text,
        done: true
      }))
      if (next !== items) return next
      return addItem(items, {
        kind: 'text',
        id: nextId('text'),
        text: event.text,
        done: true
      })
    }

    case 'thinking_delta': {
      const next = replaceLastOpen(items, 'thinking', (item) => ({
        ...(item as ThinkingItem),
        text: (item as ThinkingItem).text + event.text
      }))
      if (next !== items) return next
      return addItem(items, {
        kind: 'thinking',
        id: nextId('thinking'),
        text: event.text,
        done: false,
        startedAt: ts
      })
    }

    case 'thinking_done': {
      if (!event.text.trim()) return items
      const next = replaceLastOpen(items, 'thinking', (item) => {
        const thinking = item as ThinkingItem
        return {
          ...thinking,
          text: event.text || thinking.text,
          done: true,
          durationMs: event.durationMs ?? (thinking.startedAt ? ts - thinking.startedAt : null)
        }
      })
      if (next !== items) return next
      return addItem(items, {
        kind: 'thinking',
        id: nextId('thinking'),
        text: event.text,
        done: true,
        startedAt: ts - (event.durationMs ?? 0),
        durationMs: event.durationMs ?? null
      })
    }

    case 'tool_call': {
      const exists = items.some(
        (item) => item.kind === 'tool' && item.toolUseId === event.toolUseId
      )
      if (exists) return items
      return addItem(items, {
        kind: 'tool',
        id: nextId('tool'),
        toolUseId: event.toolUseId,
        name: event.name,
        input: event.input,
        startedAt: event.startedAt,
        status: 'running'
      })
    }

    case 'tool_result': {
      let found = false
      const next = items.map((item) => {
        if (item.kind !== 'tool' || item.toolUseId !== event.toolUseId) return item
        found = true
        return {
          ...item,
          output: event.output,
          isError: event.isError,
          durationMs: event.durationMs,
          status: event.isError ? ('error' as const) : ('done' as const),
          ...(event.diff ? { diff: event.diff } : {})
        }
      })
      return found ? next : items
    }

    case 'permission_request':
      return addItem(items, {
        kind: 'permission',
        id: nextId('permission'),
        requestId: event.requestId,
        toolName: event.toolName,
        input: event.input,
        suggestions: event.suggestions,
        ...(event.decisionReason ? { decisionReason: event.decisionReason } : {}),
        ...(event.title ? { title: event.title } : {}),
        ...(event.blockedPath ? { blockedPath: event.blockedPath } : {}),
        status: 'pending',
        at: ts
      })

    case 'compact_boundary':
      return addItem(items, {
        kind: 'notice',
        id: nextId('notice'),
        text: `上下文已压缩（${event.trigger === 'auto' ? '自动' : '手动'}）：${event.preTokens.toLocaleString(
          'en-US'
        )} tokens`,
        at: ts
      })

    case 'memory_note':
      return addItem(items, {
        kind: 'notice',
        id: nextId('notice'),
        text: event.message,
        at: ts
      })

    case 'error':
      return addItem(items, {
        kind: 'error',
        id: nextId('error'),
        message: event.message,
        retryable: event.retryable,
        at: ts
      })

    case 'turn_end':
      return closeStreams(
        items,
        event.isError ? '本轮异常结束，工具未返回结果。' : '本轮结束，工具未返回结果。'
      )

    default:
      return items
  }
}

function replayItems(events: RelayEvent[]): TimelineItem[] {
  let items: TimelineItem[] = []
  for (const envelope of events) {
    items = reduceItems(items, envelope.event, envelope.ts)
  }
  return closeStreams(items, '历史记录中这一轮没有工具结果。')
}

// ------------------------------------------------------------------- reducer

function applyEvent(state: RelayState, envelope: RelayEvent): RelayState {
  const event = envelope.event
  const trace = [...state.trace, envelope].slice(-300)
  const items = reduceItems(state.items, event, envelope.ts)

  switch (event.type) {
    case 'status': {
      const interrupted = event.state === 'stopped' || event.state === 'error'
      return {
        ...state,
        trace,
        phase: event.state,
        items: interrupted
          ? closeRunningTools(items, '会话已停止，工具未返回结果。')
          : items
      }
    }
    case 'turn_end':
      return {
        ...state,
        trace,
        items,
        phase: event.isError ? 'error' : 'idle'
      }
    case 'session_started':
      return {
        ...state,
        trace,
        current: state.current
          ? {
              ...state.current,
              model: event.model,
              cwd: event.cwd,
              cliVersion: event.cliVersion
            }
          : state.current
      }
    default:
      return { ...state, trace, items }
  }
}

function errorItem(message: string): ErrorItem {
  return {
    kind: 'error',
    id: nextId('error'),
    message,
    retryable: false,
    at: Date.now()
  }
}

// -------------------------------------------------------------------- store

export const useRelayStore = create<RelayState>((set, get) => ({
  bootstrapped: false,
  fatal: null,
  bootstrap: null,
  sessions: [],
  current: null,
  activeId: null,
  phase: 'idle',
  items: [],
  trace: [],
  queued: [],
  draft: '',
  drawer: null,
  themeMode: 'system',
  devMode: false,
  sidebarOpen: true,
  maximized: false,
  sending: false,

  init: async () => {
    if (initStarted) return
    initStarted = true
    const result = await window.relay.bootstrap()
    if (!result.ok) {
      set({ bootstrapped: true, fatal: result.error.message })
      return
    }
    const bootstrap = result.data
    set({
      bootstrapped: true,
      bootstrap,
      sessions: bootstrap.sessions,
      current: bootstrap.session,
      activeId: bootstrap.session?.id ?? null,
      phase: 'idle',
      themeMode: bootstrap.settings.theme,
      devMode: bootstrap.settings.devMode
    })

    window.relay.onEvent((event) => get().handleEvent(event))
    window.relay.onPermissionCancelled((requestId) => {
      set((state) => ({
        items: state.items.map((item) =>
          item.kind === 'permission' && item.requestId === requestId && item.status === 'pending'
            ? { ...item, status: 'denied' as const }
            : item
        )
      }))
    })
    window.relay.onWindowMaximized((maximized) => set({ maximized }))

    // A renderer reload during development keeps the runtime alive; rebuild
    // the visible timeline from disk so the UI does not start blank.
    if (bootstrap.session) {
      const detail = await window.relay.loadSession(bootstrap.session.id)
      if (detail.ok) {
        set({ items: replayItems(detail.data.events), phase: 'idle' })
      }
    }
  },

  handleEvent: (envelope) => {
    const state = get()
    if (!state.activeId || envelope.sessionId !== state.activeId) return
    set(applyEvent(state, envelope))
    if (envelope.event.type === 'turn_end') {
      void get().refreshSessions()
      if (get().queued.length > 0) {
        setTimeout(() => {
          void get().flushQueue()
        }, 0)
      }
    }
    if (envelope.event.type === 'session_started') {
      void get().refreshSessions()
    }
  },

  refreshBootstrap: async () => {
    const result = await window.relay.bootstrap()
    if (!result.ok) {
      set({ fatal: result.error.message })
      return
    }
    set((state) => ({
      bootstrap: result.data,
      sessions: result.data.sessions,
      themeMode: result.data.settings.theme,
      devMode: result.data.settings.devMode,
      current: state.current ?? result.data.session
    }))
  },

  refreshSessions: async () => {
    const result = await window.relay.listSessions()
    if (result.ok) set({ sessions: result.data })
  },

  setDraft: (value) => set({ draft: value }),

  send: async (text) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const state = get()
    if (state.phase === 'busy' || state.phase === 'starting') {
      set({ queued: [...state.queued, trimmed], draft: '' })
      return
    }
    if (!state.bootstrap?.hasApiKey) {
      set({ drawer: 'settings' })
      return
    }

    let current = state.current
    if (!current) {
      if (!state.activeId) {
        await get().newSession()
        current = get().current
      } else {
        set({ phase: 'starting' })
        const started = await window.relay.startSession({ sessionId: state.activeId })
        if (!started.ok) {
          set((s) => ({ phase: 'error', items: addItem(s.items, errorItem(started.error.message)) }))
          return
        }
        set({ current: started.data, phase: 'ready' })
        current = started.data
      }
      if (!get().current) return
    }

    set({ draft: '', phase: 'busy', sending: true })
    const result = await window.relay.send(trimmed)
    set({ sending: false })
    if (!result.ok) {
      set((s) => ({
        phase: 'error',
        items: addItem(s.items, errorItem(result.error.message))
      }))
      return
    }
    void get().refreshSessions()
  },

  flushQueue: async () => {
    const state = get()
    if (state.phase === 'busy' || state.phase === 'starting') return
    const next = state.queued[0]
    if (!next) return
    set({ queued: state.queued.slice(1) })
    await get().send(next)
  },

  interrupt: async () => {
    const result = await window.relay.interrupt()
    if (!result.ok) {
      set((s) => ({ items: addItem(s.items, errorItem(result.error.message)) }))
    }
  },

  retryLast: async () => {
    const items = get().items
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index]
      if (item?.kind === 'user') {
        await get().send(item.text)
        return
      }
    }
  },

  newSession: async () => {
    const state = get()
    if (!state.bootstrap?.hasApiKey) {
      set({ drawer: 'settings' })
      return
    }
    set({ phase: 'starting' })
    const result = await window.relay.startSession({})
    if (!result.ok) {
      set((s) => ({ phase: 'error', items: addItem(s.items, errorItem(result.error.message)) }))
      return
    }
    set({
      current: result.data,
      activeId: result.data.id,
      items: [],
      trace: [],
      phase: 'ready'
    })
    await get().refreshSessions()
    if (get().queued.length > 0) {
      setTimeout(() => {
        void get().flushQueue()
      }, 0)
    }
  },

  openSession: async (sessionId) => {
    const state = get()
    if (state.activeId === sessionId && state.current) return
    if (state.current) {
      await window.relay.stopSession()
    }
    const detail = await window.relay.loadSession(sessionId)
    if (!detail.ok) {
      set((s) => ({ items: addItem(s.items, errorItem(detail.error.message)) }))
      return
    }
    set({
      activeId: sessionId,
      current: null,
      items: replayItems(detail.data.events),
      trace: [],
      queued: [],
      phase: 'idle'
    })

    if (!get().bootstrap?.hasApiKey) return
    set({ phase: 'starting' })
    const started = await window.relay.startSession({ sessionId })
    if (!started.ok) {
      set((s) => ({ phase: 'error', items: addItem(s.items, errorItem(started.error.message)) }))
      return
    }
    set({ current: started.data, phase: 'ready' })
    if (get().queued.length > 0) {
      setTimeout(() => {
        void get().flushQueue()
      }, 0)
    }
  },

  renameSession: async (sessionId, title) => {
    const result = await window.relay.renameSession(sessionId, title)
    if (result.ok) {
      set((state) => ({
        sessions: state.sessions.map((record) =>
          record.id === sessionId ? result.data : record
        )
      }))
    }
    return result
  },

  deleteSession: async (sessionId) => {
    const result = await window.relay.deleteSession(sessionId)
    if (!result.ok) {
      set((s) => ({ items: addItem(s.items, errorItem(result.error.message)) }))
      return
    }
    set((state) => ({
      sessions: state.sessions.filter((record) => record.id !== sessionId),
      ...(state.activeId === sessionId
        ? { activeId: null, current: null, items: [], trace: [], phase: 'idle' as const }
        : {})
    }))
  },

  respondPermission: async (requestId, decision, message) => {
    set((state) => ({
      items: state.items.map((item) =>
        item.kind === 'permission' && item.requestId === requestId
          ? { ...item, status: decision === 'deny' ? ('denied' as const) : ('allowed' as const) }
          : item
      )
    }))
    const result = await window.relay.respondPermission({
      requestId,
      decision,
      ...(message?.trim() ? { message: message.trim() } : {})
    })
    if (!result.ok) {
      set((s) => ({ items: addItem(s.items, errorItem(result.error.message)) }))
    }
  },

  openDrawer: (drawer) => set({ drawer }),

  setThemeMode: async (mode) => {
    set({ themeMode: mode })
    const result = await window.relay.saveSettings({ theme: mode })
    if (result.ok) await get().refreshBootstrap()
  },

  setDevMode: async (enabled) => {
    set({ devMode: enabled, ...(enabled ? {} : { drawer: get().drawer === 'trace' ? null : get().drawer }) })
    const result = await window.relay.saveSettings({ devMode: enabled })
    if (result.ok) await get().refreshBootstrap()
  },

  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setMaximized: (maximized) => set({ maximized }),

  chooseWorkspace: async () => {
    const result = await window.relay.chooseWorkspace()
    if (result.ok && result.data) {
      await get().refreshBootstrap()
    }
  },

  saveSettings: async (patch) => {
    const result = await window.relay.saveSettings(patch)
    if (result.ok) await get().refreshBootstrap()
    return result
  },

  writeWorkspaceConfig: async (values) => {
    const cwd = get().bootstrap?.settings.workspace
    const written = await window.relay.writeWorkspaceConfig(cwd, values)
    if (!written.ok) return written
    const result = await window.relay.bootstrap()
    if (result.ok) {
      set({ bootstrap: result.data, sessions: result.data.sessions })
    }
    return result
  },

  clearWorkspaceConfig: async () => {
    const cwd = get().bootstrap?.settings.workspace
    const cleared = await window.relay.clearWorkspaceConfig(cwd)
    if (!cleared.ok) return cleared
    const result = await window.relay.bootstrap()
    if (result.ok) {
      set({ bootstrap: result.data, sessions: result.data.sessions })
    }
    return result
  }
}))

export type { EffortLevel, VisiblePermissionMode, ThemeMode }
