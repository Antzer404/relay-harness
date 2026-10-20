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

export const DEFAULT_PROJECT_AGENTS: ProjectAgentSpec[] = [
  {
    id: 'architect',
    label: '架构',
    description: '方案设计、技术选型、接口与数据模型、任务拆分',
    prompt:
      '你是项目团队中的架构 agent。你负责方案设计、技术选型、接口与数据模型、任务拆分。先读代码与文档再下结论；输出结构化的设计说明、风险与取舍。除非任务明确要求，不要直接改业务代码。'
  },
  {
    id: 'backend',
    label: '后端',
    description: '服务端、数据库、接口、脚本与基础设施实现',
    prompt:
      '你是项目团队中的后端 agent。你负责服务端、数据库、接口、脚本与基础设施代码的实现。严格按任务单的范围工作，先读相关代码再动手；完成后报告改动文件、验证命令与结果。'
  },
  {
    id: 'frontend',
    label: '前端',
    description: '界面、交互、样式与客户端逻辑实现',
    prompt:
      '你是项目团队中的前端 agent。你负责界面、交互、样式与客户端逻辑。保持与现有设计语言一致，遵循仓库的组件与样式约定；完成后报告改动文件、验证方式与已知问题。'
  },
  {
    id: 'tester',
    label: '测试',
    description: '测试设计、问题复现、运行验证与验收',
    prompt:
      '你是项目团队中的测试 agent。你负责测试设计、用例编写、问题复现与运行验证。优先用最小复现定位问题；报告必须包含复现步骤、期望与实际结果、相关日志与文件。'
  }
]

/** Reads the optional roster file; invalid files fall back to the defaults. */
export function loadProjectRoster(cwd: string): ProjectRoster {
  const path = join(cwd, '.relay', 'agents.json')
  if (!existsSync(path)) {
    return { specs: DEFAULT_PROJECT_AGENTS, source: 'default', error: null }
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const result = projectRosterFileSchema.safeParse(parsed)
    if (!result.success) {
      const first = result.error.issues[0]
      return {
        specs: DEFAULT_PROJECT_AGENTS,
        source: 'default',
        error: `agents.json 无效${first ? `：${first.path.join('.')} ${first.message}` : ''}`
      }
    }
    return { specs: result.data.agents, source: 'file', error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      specs: DEFAULT_PROJECT_AGENTS,
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
 * Appended to the leader's system prompt. Agents are exposed through the
 * Agent tool; this text is what makes the model use them as a team.
 */
export function projectLeaderPrompt(specs: ProjectAgentSpec[]): string {
  const lines = specs.map((spec) => `- ${spec.id}（${spec.label}）：${spec.description}`)
  return [
    '## 团队协作模式（Project）',
    '你现在是这个项目的 Leader。用户只与你对话，你负责计划、分派、验收与汇总。',
    '可用成员（通过 Agent/Task 工具的 subagent_type 指定）：',
    ...lines,
    '',
    '工作纪律：',
    '1. 收到目标后先用几句话给出计划：分步、负责人、验收标准；然后直接开始执行，不必等待用户确认。',
    '2. 每个任务单必须自包含：目标、背景、约束、涉及文件、验收标准。worker 看不到你与用户的对话，不要假设它知道上下文。',
    '3. 能并行的任务在同一条消息里并行派发；有依赖的按顺序执行。',
    '4. worker 的产出只是材料，由你核对、整合并对用户负责；不要把你该做的判断转交出去。',
    '5. 收到报告后继续派发或汇总。最终回复面向用户：做了什么、如何验证、未解决项。',
    '6. 简单任务（纯问答、单文件小改动）自己做，不要为派发而派发。'
  ].join('\n')
}
