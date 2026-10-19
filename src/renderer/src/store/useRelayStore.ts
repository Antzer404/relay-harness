import { create } from 'zustand'
import type {
  BootstrapState,
  EffortLevel,
  HarnessEvent,
  PermissionDecisionKind,
  RelayEvent,
  SessionPhase,
  SessionSummary,
  UsageSnapshot,
  VisiblePermissionMode
} from '@shared/events'

export interface UserItem {
  kind: 'user'
  id: string
  text: string
  at: number
  turn: number
}

export interface TextItem {
  kind: 'text'
  id: string
  text: string
  done: boolean
}

export interface ThinkingItem {
  kind: 'thinking'
  id: string
  text: string
  done: boolean
  startedAt: number
}

export interface ToolItem {
  kind: 'tool'
  id: string
  toolUseId: string
  name: string
  input: unknown
  output?: string
  isError?: boolean
  startedAt: number
  durationMs?: number | null
  status: 'running' | 'done' | 'error'
}

export interface ErrorItem {
  kind: 'error'
  id: string
  message: string
  retryable: boolean
  at: number
}

export interface NoticeItem {
  kind: 'notice'
  id: string
  text: string
  at: number
}

export type TimelineItem =
  | UserItem
  | TextItem
  | ThinkingItem
  | ToolItem
  | ErrorItem
  | NoticeItem

export type PermissionRequest = Extract<HarnessEvent, { type: 'permission_request' }>

export type RightTab = 'context' | 'trace' | 'setup'
export type Theme = 'light' | 'dark'

let counter = 0
let initStarted = false
const nextId = (prefix: string): string => {
  counter += 1
  return `${prefix}-${counter}`
}

interface RelayState {
  bootstrapped: boolean
  fatal: string | null
  bootstrap: BootstrapState | null
  session: SessionSummary | null
  phase: SessionPhase
  items: TimelineItem[]
  usage: UsageSnapshot | null
  trace: RelayEvent[]
  pendingPermission: PermissionRequest | null
  turnCounter: number
  rightOpen: boolean
  rightTab: RightTab
  theme: Theme
  draft: string

  init: () => Promise<void>
  handleEvent: (event: RelayEvent) => void
  refreshBootstrap: () => Promise<void>
  setDraft: (value: string) => void
  send: (text: string) => Promise<void>
  interrupt: () => Promise<void>
  startSession: () => Promise<void>
  respondPermission: (decision: PermissionDecisionKind, message?: string) => Promise<void>
  setRightTab: (tab: RightTab) => void
  toggleRight: () => void
  toggleTheme: () => void
}

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

export const useRelayStore = create<RelayState>((set, get) => ({
  bootstrapped: false,
  fatal: null,
  bootstrap: null,
  session: null,
  phase: 'idle',
  items: [],
  usage: null,
  trace: [],
  pendingPermission: null,
  turnCounter: 0,
  rightOpen: true,
  rightTab: 'context',
  theme: 'light',
  draft: '',

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
      session: bootstrap.session,
      phase: bootstrap.session ? 'ready' : 'idle',
      rightTab: bootstrap.hasApiKey ? 'context' : 'setup',
      rightOpen: true
    })

    window.relay.onEvent((event) => get().handleEvent(event))
    window.relay.onPermissionCancelled((requestId) => {
      const pending = get().pendingPermission
      if (pending?.requestId === requestId) set({ pendingPermission: null })
    })

    if (bootstrap.hasApiKey) {
      await get().startSession()
    }
  },

  handleEvent: (event) => set((state) => reduceEvent(state, event)),

  refreshBootstrap: async () => {
    const result = await window.relay.bootstrap()
    if (!result.ok) {
      set({ fatal: result.error.message })
      return
    }
    const previous = get().bootstrap
    set({
      bootstrap: result.data,
      session: result.data.session ?? get().session,
      ...(previous
        ? {}
        : { rightTab: result.data.hasApiKey ? ('context' as const) : ('setup' as const) })
    })
  },

  setDraft: (value) => set({ draft: value }),

  send: async (text) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const state = get()
    if (!state.session) return
    if (state.phase === 'busy' || state.phase === 'starting') return

    const turn = state.turnCounter + 1
    set({
      phase: 'busy',
      turnCounter: turn,
      draft: '',
      items: addItem(state.items, {
        kind: 'user',
        id: nextId('user'),
        text: trimmed,
        at: Date.now(),
        turn
      })
    })

    const result = await window.relay.send(trimmed)
    if (!result.ok) {
      set((current) => ({
        phase: 'error',
        items: addItem(current.items, {
          kind: 'error',
          id: nextId('error'),
          message: result.error.message,
          retryable: false,
          at: Date.now()
        })
      }))
    }
  },

  interrupt: async () => {
    const result = await window.relay.interrupt()
    if (!result.ok) {
      set({ fatal: result.error.message })
    }
  },

  startSession: async () => {
    const state = get()
    if (!state.bootstrap?.hasApiKey) {
      set({ rightOpen: true, rightTab: 'setup' })
      return
    }
    set({
      phase: 'starting',
      session: null,
      items: [],
      usage: null,
      pendingPermission: null,
      turnCounter: 0,
      fatal: null
    })
    const result = await window.relay.startSession({})
    if (!result.ok) {
      set((current) => ({
        phase: 'error',
        items: addItem(current.items, {
          kind: 'error',
          id: nextId('error'),
          message: result.error.message,
          retryable: false,
          at: Date.now()
        })
      }))
      return
    }
    set({ session: result.data, phase: 'ready' })
  },

  respondPermission: async (decision, message) => {
    const pending = get().pendingPermission
    if (!pending) return
    set({ pendingPermission: null })
    const result = await window.relay.respondPermission({
      requestId: pending.requestId,
      decision,
      ...(message?.trim() ? { message: message.trim() } : {})
    })
    if (!result.ok) {
      set((current) => ({
        pendingPermission: pending,
        items: addItem(current.items, {
          kind: 'error',
          id: nextId('error'),
          message: result.error.message,
          retryable: false,
          at: Date.now()
        })
      }))
    }
  },

  setRightTab: (tab) => set({ rightTab: tab, rightOpen: true }),
  toggleRight: () => set((state) => ({ rightOpen: !state.rightOpen })),
  toggleTheme: () => set((state) => ({ theme: state.theme === 'light' ? 'dark' : 'light' }))
}))

function reduceEvent(state: RelayState, envelope: RelayEvent): RelayState {
  // Ignore events from a session that is being replaced, and anything that
  // arrives before the new session id is known.
  if (!state.session || envelope.sessionId !== state.session.id) return state
  const event = envelope.event
  const trace = [...state.trace, envelope].slice(-200)

  switch (event.type) {
    case 'session_started':
      return {
        ...state,
        trace,
        session: state.session
          ? {
              ...state.session,
              model: event.model,
              cwd: event.cwd,
              cliVersion: event.cliVersion
            }
          : state.session
      }

    case 'status': {
      const interrupted = event.state === 'stopped' || event.state === 'error'
      return {
        ...state,
        trace,
        phase: event.state,
        items: interrupted ? closeRunningTools(state.items, '会话已停止，工具未返回结果。') : state.items
      }
    }

    case 'text_delta': {
      const items = replaceLastOpen(state.items, 'text', (item) => ({
        ...(item as TextItem),
        text: (item as TextItem).text + event.text
      }))
      if (items !== state.items) return { ...state, trace, items }
      return {
        ...state,
        trace,
        items: addItem(state.items, {
          kind: 'text',
          id: nextId('text'),
          text: event.text,
          done: false
        })
      }
    }

    case 'text_done': {
      if (!event.text) return { ...state, trace }
      const items = replaceLastOpen(state.items, 'text', (item) => ({
        ...(item as TextItem),
        text: event.text,
        done: true
      }))
      if (items !== state.items) return { ...state, trace, items }
      return {
        ...state,
        trace,
        items: addItem(state.items, {
          kind: 'text',
          id: nextId('text'),
          text: event.text,
          done: true
        })
      }
    }

    case 'thinking_delta': {
      const items = replaceLastOpen(state.items, 'thinking', (item) => ({
        ...(item as ThinkingItem),
        text: (item as ThinkingItem).text + event.text
      }))
      if (items !== state.items) return { ...state, trace, items }
      return {
        ...state,
        trace,
        items: addItem(state.items, {
          kind: 'thinking',
          id: nextId('thinking'),
          text: event.text,
          done: false,
          startedAt: Date.now()
        })
      }
    }

    case 'thinking_done': {
      const items = replaceLastOpen(state.items, 'thinking', (item) => ({
        ...(item as ThinkingItem),
        text: event.text || (item as ThinkingItem).text,
        done: true
      }))
      if (items !== state.items) return { ...state, trace, items }
      if (!event.text) {
        const last = state.items[state.items.length - 1]
        if (last?.kind === 'thinking' && last.done) return { ...state, trace }
      }
      // No reasoning stream: show an explicit placeholder at the start of the
      // turn rather than appending it after the answer.
      let insertAt = state.items.length
      for (let index = state.items.length - 1; index >= 0; index -= 1) {
        if (state.items[index]?.kind === 'user') {
          insertAt = index + 1
          break
        }
      }
      const next = [...state.items]
      next.splice(insertAt, 0, {
        kind: 'thinking',
        id: nextId('thinking'),
        text: event.text,
        done: true,
        startedAt: Date.now()
      })
      return { ...state, trace, items: next }
    }

    case 'tool_call': {
      const exists = state.items.some(
        (item) => item.kind === 'tool' && item.toolUseId === event.toolUseId
      )
      if (exists) return { ...state, trace }
      return {
        ...state,
        trace,
        items: addItem(state.items, {
          kind: 'tool',
          id: nextId('tool'),
          toolUseId: event.toolUseId,
          name: event.name,
          input: event.input,
          startedAt: event.startedAt,
          status: 'running'
        })
      }
    }

    case 'tool_result':
      return {
        ...state,
        trace,
        items: state.items.map((item) =>
          item.kind === 'tool' && item.toolUseId === event.toolUseId
            ? {
                ...item,
                output: event.output,
                isError: event.isError,
                durationMs: event.durationMs,
                status: event.isError ? ('error' as const) : ('done' as const)
              }
            : item
        )
      }

    case 'permission_request':
      return {
        ...state,
        trace,
        pendingPermission: event,
        phase: 'busy'
      }

    case 'usage':
      return { ...state, trace, usage: event.usage }

    case 'compact_boundary':
      return {
        ...state,
        trace,
        items: addItem(state.items, {
          kind: 'notice',
          id: nextId('notice'),
          text: `上下文已压缩（${event.trigger === 'auto' ? '自动' : '手动'}）：${event.preTokens.toLocaleString(
            'en-US'
          )} tokens`,
          at: Date.now()
        })
      }

    case 'turn_end':
      return {
        ...state,
        trace,
        phase: event.isError ? 'error' : 'idle',
        items: closeRunningTools(
          state.items.map((item) => {
            if (item.kind === 'text' && !item.done) return { ...item, done: true }
            if (item.kind === 'thinking' && !item.done) return { ...item, done: true }
            return item
          }),
          event.isError ? '本轮异常结束，工具未返回结果。' : '本轮结束，工具未返回结果。'
        )
      }

    case 'error':
      return {
        ...state,
        trace,
        items: addItem(state.items, {
          kind: 'error',
          id: nextId('error'),
          message: event.message,
          retryable: event.retryable,
          at: Date.now()
        })
      }

    case 'memory_note':
      return {
        ...state,
        trace,
        items: addItem(state.items, {
          kind: 'notice',
          id: nextId('notice'),
          text: event.message,
          at: Date.now()
        })
      }

    default:
      return { ...state, trace }
  }
}
