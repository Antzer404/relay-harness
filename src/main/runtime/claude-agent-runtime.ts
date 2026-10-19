import { randomUUID } from 'node:crypto'
import {
  query,
  type CanUseTool,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import type {
  HarnessEvent,
  PermissionDecision,
  PermissionSuggestionView,
  SessionPhase,
  UsageSnapshot
} from '@shared/events'
import { EventNormalizer } from './normalizer'
import type {
  RuntimeAdapter,
  RuntimeSessionHandle,
  StartSessionOptions,
  UserInput
} from './types'

class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = []
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = []
  private closed = false

  push(value: T): void {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter) waiter({ value, done: false })
    else this.values.push(value)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined as never, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.values.length > 0) {
          return Promise.resolve({ value: this.values.shift() as T, done: false })
        }
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true })
        return new Promise((resolve) => this.waiters.push(resolve))
      }
    }
  }
}

interface PendingPermission {
  resolve: (result: PermissionResult) => void
  cleanup: () => void
  rawSuggestions: PermissionUpdate[]
  toolUseId: string
}

interface SessionState {
  options: StartSessionOptions
  query: Query
  input: AsyncQueue<SDKUserMessage>
  normalizer: EventNormalizer
  permissions: Map<string, PendingPermission>
  usage: UsageSnapshot | null
  closed: boolean
  stderr: string[]
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function describeSuggestion(update: PermissionUpdate): PermissionSuggestionView {
  switch (update.type) {
    case 'addRules':
    case 'replaceRules':
    case 'removeRules':
      return {
        label: update.rules
          .map((rule) =>
            rule.ruleContent ? `${rule.toolName}(${rule.ruleContent})` : rule.toolName
          )
          .join(', '),
        destination: update.destination,
        toolName: update.rules.map((rule) => rule.toolName).join(', '),
        ruleContent: update.rules.map((rule) => rule.ruleContent ?? '').join(', ')
      }
    case 'setMode':
      return {
        label: `切换到权限模式 ${update.mode}`,
        destination: update.destination,
        mode: update.mode
      }
    case 'addDirectories':
      return {
        label: `添加目录 ${update.directories.join(', ')}`,
        destination: update.destination
      }
    case 'removeDirectories':
      return {
        label: `移除目录 ${update.directories.join(', ')}`,
        destination: update.destination
      }
  }
}

function buildEnv(options: StartSessionOptions): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value
  }

  // Never let an ambient credential win over the key the user stored in Relay.
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  delete env.CLAUDE_CODE_OAUTH_TOKEN
  delete env.CLAUDE_CODE_USE_BEDROCK
  delete env.CLAUDE_CODE_USE_VERTEX
  delete env.CLAUDE_CODE_USE_FOUNDRY

  env.ANTHROPIC_BASE_URL = options.baseUrl
  env.ANTHROPIC_AUTH_TOKEN = options.apiKey
  env.ANTHROPIC_MODEL = options.model
  env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'deepseek-v4-pro[1m]'
  env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'deepseek-flash[1m]'
  env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'deepseek-flash'
  env.CLAUDE_CODE_SUBAGENT_MODEL = 'deepseek-flash'
  env.CLAUDE_CODE_EFFORT_LEVEL = options.effort
  env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = '786432'
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
  env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '1'
  env.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING = '1'
  env.DISABLE_AUTOUPDATER = '1'
  env.CLAUDE_CONFIG_DIR = options.claudeConfigDir

  return env
}

export class ClaudeAgentRuntime implements RuntimeAdapter {
  private readonly sessions = new Map<string, SessionState>()
  private readonly listeners = new Set<(sessionId: string, event: HarnessEvent) => void>()

  onEvent(listener: (sessionId: string, event: HarnessEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async startSession(options: StartSessionOptions): Promise<RuntimeSessionHandle> {
    const input = new AsyncQueue<SDKUserMessage>()
    const state: SessionState = {
      options,
      input,
      query: undefined as unknown as Query,
      normalizer: undefined as unknown as EventNormalizer,
      permissions: new Map(),
      usage: null,
      closed: false,
      stderr: []
    }

    const canUseTool: CanUseTool = async (toolName, toolInput, { signal, suggestions, decisionReason, title, blockedPath, toolUseID }) => {
      if (state.closed) {
        return { behavior: 'deny', message: '会话已关闭' }
      }
      const requestId = randomUUID()
      // "Always allow" is scoped to this session: never let a suggestion write
      // global user settings from inside Relay.
      const rawSuggestions = (suggestions ?? []).map((suggestion) => ({
        ...suggestion,
        destination: 'session' as const
      }))
      this.emit(options.sessionId, {
        type: 'permission_request',
        requestId,
        toolName,
        input: toolInput,
        suggestions: rawSuggestions.map(describeSuggestion),
        ...(decisionReason ? { decisionReason } : {}),
        ...(title ? { title } : {}),
        ...(blockedPath ? { blockedPath } : {})
      })

      return new Promise<PermissionResult>((resolve) => {
        const onAbort = (): void => {
          state.permissions.delete(requestId)
          resolve({ behavior: 'deny', message: '操作已取消' })
        }
        signal.addEventListener('abort', onAbort, { once: true })
        const cleanup = (): void => signal.removeEventListener('abort', onAbort)
        state.permissions.set(requestId, { resolve, cleanup, rawSuggestions, toolUseId: toolUseID })
      })
    }

    state.normalizer = new EventNormalizer((event) => {
      if (event.type === 'usage') state.usage = event.usage
      this.emit(options.sessionId, event)
    })

    const queryOptions = {
      cwd: options.cwd,
      model: options.model,
      permissionMode: options.permissionMode,
      includePartialMessages: true,
      canUseTool,
      systemPrompt: {
        type: 'preset' as const,
        preset: 'claude_code' as const,
        ...(options.systemPromptAppend ? { append: options.systemPromptAppend } : {})
      },
      settingSources: ['project' as const],
      ...(options.allowedTools && options.allowedTools.length > 0
        ? { allowedTools: options.allowedTools }
        : {}),
      env: buildEnv(options),
      stderr: (data: string) => {
        const line = data.trim()
        if (!line) return
        state.stderr.push(line)
        if (state.stderr.length > 40) state.stderr.shift()
      },
      ...(options.cliSessionId
        ? { resume: options.cliSessionId }
        : { sessionId: options.sessionId }),
      ...(options.executablePath ? { pathToClaudeCodeExecutable: options.executablePath } : {})
    }

    state.query = query({ prompt: input, options: queryOptions })
    this.sessions.set(options.sessionId, state)
    void this.consume(state)

    return {
      sessionId: options.sessionId,
      cwd: options.cwd,
      model: options.model
    }
  }

  private async consume(state: SessionState): Promise<void> {
    const { sessionId } = state.options
    try {
      for await (const message of state.query) {
        if (state.closed) break
        state.normalizer.normalize(message)
        if (message.type === 'result') {
          this.emitStatus(sessionId, 'idle')
        }
      }
    } catch (error) {
      if (!state.closed) {
        const detail = error instanceof Error ? error.message : String(error)
        const tail = state.stderr.slice(-5).join('\n')
        this.emit(sessionId, {
          type: 'error',
          code: 'runtime_failure',
          message: tail ? `${detail}\n${tail}` : detail,
          retryable: false
        })
        this.emitStatus(sessionId, 'error')
      }
    } finally {
      state.input.close()
      for (const [requestId, pending] of state.permissions) {
        pending.cleanup()
        pending.resolve({ behavior: 'deny', message: '会话已结束' })
        state.permissions.delete(requestId)
      }
    }
  }

  send(sessionId: string, input: UserInput): void {
    const state = this.sessions.get(sessionId)
    if (!state || state.closed) {
      this.emit(sessionId, {
        type: 'error',
        code: 'session_missing',
        message: '当前会话不存在或已关闭',
        retryable: false
      })
      return
    }
    state.normalizer.beginTurn()
    this.emitStatus(sessionId, 'busy')
    state.input.push({
      type: 'user',
      message: { role: 'user', content: input.text },
      parent_tool_use_id: null
    })
  }

  async interrupt(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId)
    if (!state) return
    await state.query.interrupt()
  }

  respondPermission(decision: PermissionDecision): void {
    for (const state of this.sessions.values()) {
      const pending = state.permissions.get(decision.requestId)
      if (!pending) continue
      state.permissions.delete(decision.requestId)
      pending.cleanup()

      if (decision.decision === 'deny') {
        pending.resolve({
          behavior: 'deny',
          message: decision.message?.trim() || '用户在 Relay 中拒绝了此操作。'
        })
        return
      }

      const updatedPermissions =
        decision.decision === 'always' && pending.rawSuggestions.length > 0
          ? pending.rawSuggestions
          : undefined
      if (pending.toolUseId) state.normalizer.markToolApproved(pending.toolUseId)
      pending.resolve({
        behavior: 'allow',
        ...(updatedPermissions ? { updatedPermissions } : {})
      })
      return
    }
  }

  denyAllPermissions(sessionId: string, reason: string): void {
    const state = this.sessions.get(sessionId)
    if (!state) return
    for (const [requestId, pending] of state.permissions) {
      pending.cleanup()
      pending.resolve({ behavior: 'deny', message: reason })
      state.permissions.delete(requestId)
    }
  }

  /** Diagnostic access to the CLI's stderr tail (used by smoke tests). */
  stderrTail(sessionId: string): string[] {
    return [...(this.sessions.get(sessionId)?.stderr ?? [])]
  }

  getUsage(sessionId: string): UsageSnapshot | null {
    return this.sessions.get(sessionId)?.usage ?? null
  }

  async dispose(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId)
    if (!state) return
    state.closed = true
    this.denyAllPermissions(sessionId, '会话已关闭')
    state.input.close()
    try {
      state.query.close()
    } catch {
      // Query may already be closed.
    }
    this.sessions.delete(sessionId)
    this.emitStatus(sessionId, 'stopped')
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.dispose(id)))
  }

  private emitStatus(sessionId: string, state: SessionPhase, detail?: string): void {
    this.emit(sessionId, { type: 'status', state, ...(detail ? { detail } : {}) })
  }

  private emit(sessionId: string, event: HarnessEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(sessionId, event)
      } catch {
        // A broken listener must not kill the runtime.
      }
    }
  }
}
