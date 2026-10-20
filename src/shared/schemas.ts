import { z } from 'zod'

export const apiKeySchema = z.object({
  key: z.string().trim().min(8, 'API key 长度不足').max(512, 'API key 过长')
})

export const settingsPatchSchema = z
  .object({
    baseUrl: z
      .string()
      .trim()
      .max(2048)
      .refine(
        (value) => {
          try {
            const url = new URL(value)
            return url.protocol === 'https:' || url.protocol === 'http:'
          } catch {
            return false
          }
        },
        { message: 'Base URL 必须是 http(s) 地址' }
      )
      .optional(),
    model: z.string().trim().min(1).max(200).optional(),
    effort: z.enum(['high', 'max']).optional(),
    permissionMode: z.enum(['default', 'plan', 'acceptEdits']).optional(),
    workspace: z.string().trim().min(1).max(4096).optional(),
    theme: z.enum(['light', 'dark', 'system']).optional(),
    devMode: z.boolean().optional(),
    handoffThreshold: z.number().int().min(50).max(90).optional()
  })
  .strict()

export const startSessionSchema = z
  .object({
    sessionId: z.uuid().optional()
  })
  .strict()

export const sessionIdSchema = z.object({
  sessionId: z.uuid()
})

export const renameSessionSchema = z
  .object({
    sessionId: z.uuid(),
    title: z.string().trim().min(1, '标题不能为空').max(120, '标题过长')
  })
  .strict()

export const workspaceConfigSchema = z
  .object({
    cwd: z.string().trim().min(1).max(4096).optional(),
    values: z
      .object({
        model: z.string().trim().min(1).max(200).optional(),
        effort: z.enum(['high', 'max']).optional(),
        permissionMode: z.enum(['default', 'plan', 'acceptEdits']).optional(),
        systemPromptAppend: z.string().max(20_000).optional(),
        allowedTools: z.array(z.string().trim().min(1).max(400)).max(200).optional()
      })
      .strict()
  })
  .strict()

export const workspaceConfigCwdSchema = z
  .object({
    cwd: z.string().trim().min(1).max(4096).optional()
  })
  .strict()

export const removeAllowedToolSchema = z
  .object({
    cwd: z.string().trim().min(1).max(4096).optional(),
    rule: z.string().trim().min(1).max(400)
  })
  .strict()

export const windowControlSchema = z.object({
  action: z.enum(['minimize', 'toggle-maximize', 'close'])
})

export const sendSchema = z.object({
  text: z.string().min(1, '消息不能为空').max(200_000, '消息过长'),
  interrupt: z.boolean().optional()
})

export const setPermissionModeSchema = z
  .object({
    mode: z.enum(['default', 'plan', 'acceptEdits'])
  })
  .strict()

const handoffMarkdownSchema = z
  .string()
  .trim()
  .min(1, '交接文档不能为空')
  .max(60_000, '交接文档过长')

export const handoffIdSchema = z.object({
  handoffId: z.uuid()
})

export const listHandoffsSchema = z
  .object({
    sessionId: z.uuid().optional()
  })
  .strict()

export const updateHandoffSchema = z
  .object({
    handoffId: z.uuid(),
    markdown: handoffMarkdownSchema
  })
  .strict()

export const acceptHandoffSchema = z
  .object({
    handoffId: z.uuid(),
    markdown: handoffMarkdownSchema.optional()
  })
  .strict()

export const permissionDecisionSchema = z
  .object({
    requestId: z.uuid(),
    decision: z.enum(['allow', 'always', 'deny']),
    message: z.string().max(4000).optional(),
    suggestionIndex: z.number().int().min(0).max(50).optional()
  })
  .strict()

export const skillEnabledSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    enabled: z.boolean()
  })
  .strict()
