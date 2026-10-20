import type { FileDiff, PermissionSuggestionView } from './events'

/**
 * View-model rows for the conversation timeline. They are plain serialisable
 * data produced by the renderer store from runtime events, shared here so
 * layout/virtualisation code can be unit-tested outside the DOM environment.
 */

export interface UserItem {
  kind: 'user'
  id: string
  text: string
  at: number
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
  durationMs?: number | null
}

export interface ToolItem {
  kind: 'tool'
  id: string
  toolUseId: string
  name: string
  input: unknown
  output?: string
  isError?: boolean
  diff?: FileDiff
  startedAt: number
  durationMs?: number | null
  status: 'running' | 'done' | 'error'
}

export interface PermissionItem {
  kind: 'permission'
  id: string
  requestId: string
  toolName: string
  input: unknown
  suggestions: PermissionSuggestionView[]
  decisionReason?: string
  title?: string
  blockedPath?: string
  /** Project worker that raised the request, if any. */
  agentId?: string
  agentName?: string
  status: 'pending' | 'allowed' | 'denied'
  at: number
}

export interface ErrorItem {
  kind: 'error'
  id: string
  /** Runtime/provider code, e.g. authentication_failed or runtime_failure. */
  code?: string
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
  | PermissionItem
  | ErrorItem
  | NoticeItem
