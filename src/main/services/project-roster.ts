import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { ProjectAgentView } from '@shared/events'

/** Worker definitions, overridable with `<cwd>/.relay/agents.json`. */
export interface ProjectAgentSpec {
  id: string
  label: string
  description: string
  prompt: string
  tools?: string[]
  model?: string
}

export interface ProjectRoster {
  /** User-declared specialists; empty means the leader composes the team. */
  specs: ProjectAgentSpec[]
  source: 'default' | 'file'
  error: string | null
}

const MAX_AGENTS = 6

const agentSpecSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9-]{1,30}$/, 'id 需为小写字母、数字或连字符'),
  label: z.string().trim().min(1).max(20),
  description: z.string().trim().min(1).max(160),
  prompt: z.string().trim().min(1).max(8_000),
  tools: z.array(z.string().trim().min(1).max(120)).max(60).optional(),
  model: z.string().trim().min(1).max(200).optional()
})

export const projectRosterFileSchema = z.object({
  version: z.literal(1).optional(),
  agents: z.array(agentSpecSchema).min(1).max(MAX_AGENTS)
})

/**
 * The team is not a fixed roster: the leader decides which roles a task
 * needs. `.relay/agents.json` may still declare reusable specialists, but
 * with no file the leader composes the team from the generic worker agent.
 */
export function loadProjectRoster(cwd: string): ProjectRoster {
  const path = join(cwd, '.relay', 'agents.json')
  if (!existsSync(path)) {
    return { specs: [], source: 'default', error: null }
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const result = projectRosterFileSchema.safeParse(parsed)
    if (!result.success) {
      const first = result.error.issues[0]
      return {
        specs: [],
        source: 'default',
        error: `agents.json 无效${first ? `：${first.path.join('.')} ${first.message}` : ''}`
      }
    }
    return { specs: result.data.agents, source: 'file', error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      specs: [],
      source: 'default',
      error: `agents.json 解析失败：${message}`
    }
  }
}

export function projectAgentViews(specs: ProjectAgentSpec[]): ProjectAgentView[] {
  return specs.map((spec) => ({
    id: spec.id,
    label: spec.label,
    description: spec.description
  }))
}

/** Converted to the SDK's AgentDefinition map consumed by the Agent tool. */
export function buildProjectAgentDefinitions(
  specs: ProjectAgentSpec[]
): Record<string, AgentDefinition> {
  const agents: Record<string, AgentDefinition> = {}
  for (const spec of specs) {
    agents[spec.id] = {
      description: `${spec.label}：${spec.description}`,
      prompt: spec.prompt,
      ...(spec.tools && spec.tools.length > 0 ? { tools: spec.tools } : {}),
      ...(spec.model ? { model: spec.model } : {})
    }
  }
  return agents
}

/**
 * Appended to the leader's system prompt. The team is composed by the leader
 * per task; generic workers are dispatched through the built-in Agent tool
 * with a role written into the task brief. `specs` is only the optional set
 * of specialists the workspace declared in `.relay/agents.json`.
 */
export function projectLeaderPrompt(specs: ProjectAgentSpec[] = []): string {
  const lines = [
    '## 团队协作模式（Project）',
    '你是这个项目的 Leader。用户只与你对话；你负责计划、组建团队、派发、验收与汇总。',
    '团队成员不预设，由你根据任务自行判断。通过 Task 工具派遣子代理：',
    '1. 收到目标后先用几句说明「团队组建」：需要哪些角色、各自负责什么、为什么；然后直接开始执行，不必等待用户确认。',
    '2. 通用成员使用 subagent_type "general-purpose"，角色与职责由你在任务单里定义；不要把团队套成固定模板。',
    '3. 每个任务单必须自包含：角色、目标、背景、约束、涉及文件、验收标准。worker 看不到你与用户的对话，不要假设它知道上下文。',
    '4. 派发时把角色写在任务单第一行（例如「角色：接口调研」），团队面板会用任务描述展示这个成员。',
    '5. 能并行的任务在同一条消息里并行派发；有依赖的按顺序执行。',
    '6. 多步实现、调研、验证类任务应当组建团队；纯问答或单文件小改动自己做，不要为派发而派发。',
    '7. worker 的产出只是材料，由你核对、整合并对用户负责；不要把你该做的判断转交出去。',
    '8. 收到报告后继续派发或汇总。最终回复面向用户：做了什么、如何验证、未解决项。'
  ]
  if (specs.length > 0) {
    lines.push('', '工作区预定义了这些专员，可在合适时直接调用（也可以不用）：')
    for (const spec of specs) {
      lines.push(`- ${spec.id}（${spec.label}）：${spec.description}`)
    }
  }
  return lines.join('\n')
}
