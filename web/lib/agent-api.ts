import { z } from 'zod'

export const HistoryActionResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.unknown().optional(),
})

export const HistoryActionSchema = z.object({
  type: z.string().min(1),
  payload: z.unknown(),
  preview: z.string(),
  result: HistoryActionResultSchema.nullable(),
})

export const HistoryEntrySchema = z.object({
  prompt: z.string(),
  thinking: z.string().nullable(),
  clarificationNeeded: z.string().nullable(),
  actions: z.array(HistoryActionSchema),
})

export const AgentRouteRequestSchema = z.object({
  sessionId: z.string().min(1).max(120),
  prompt: z.string().min(1).max(4000),
  history: z.array(HistoryEntrySchema).max(20).optional(),
})

export const AgentExecuteRequestSchema = z.object({
  actionId: z.number().int().positive(),
  confirm: z.literal(true),
})
