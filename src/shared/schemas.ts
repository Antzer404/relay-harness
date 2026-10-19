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
    workspace: z.string().trim().min(1).max(4096).optional()
  })
  .strict()

export const startSessionSchema = z
  .object({
    cwd: z.string().trim().min(1).max(4096).optional(),
    resumeSessionId: z.uuid().optional()
  })
  .strict()

export const sendSchema = z.object({
  text: z.string().min(1, '消息不能为空').max(200_000, '消息过长')
})

export const permissionDecisionSchema = z
  .object({
    requestId: z.uuid(),
    decision: z.enum(['allow', 'always', 'deny']),
    message: z.string().max(4000).optional()
  })
  .strict()
