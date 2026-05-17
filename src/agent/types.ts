// Spec D2 — AgentOutput schema + action discriminated union.
//
// The AI must emit JSON that matches `AgentOutputSchema`. The dashboard route
// validates it, persists each `proposedActions` entry as an `agent_commands`
// row (status='proposed'), and the UI either auto-executes read-only actions
// (`isReadOnly === true`) or shows a Confirm button for write actions.
//
// Action types are an explicit closed enum here AND in the prompt catalog;
// adding a new action requires touching both this file and the action
// handler registry in `actions/index.ts` plus the prompt files in
// `prompts/agent/`.

import { z } from 'zod'

export const CreateManualJobActionSchema = z.object({
  type: z.literal('createManualJob'),
  payload: z.object({
    chatId: z.string().min(1),
    kind: z.enum(['date_anchored', 'revive']),
    // `offset: true` lets the model emit either UTC `Z` form or an explicit
    // offset like `+02:00`. The prompt asks for offset form, and the default
    // `.datetime()` (UTC-only) was silently rejecting every valid output
    // until both retries exhausted → "AI returned no usable plan".
    fireAtIso: z.string().datetime({ offset: true }),
    action: z.string().min(1).max(200),
    recurring: z.literal('yearly').nullable().optional(),
  }),
  preview: z.string().min(1).max(400),
})

export const CancelManualJobsActionSchema = z.object({
  type: z.literal('cancelManualJobs'),
  payload: z.object({
    chatId: z.string().min(1).optional(),
    kind: z.enum(['date_anchored', 'revive', 're_engage']).optional(),
    jobIds: z.array(z.number().int().positive()).optional(),
  }),
  preview: z.string().min(1).max(400),
})

export const DismissEscalationActionSchema = z.object({
  type: z.literal('dismissEscalation'),
  payload: z.object({
    escalationId: z.number().int().positive(),
  }),
  preview: z.string().min(1).max(400),
})

export const SummarizeChatActionSchema = z.object({
  type: z.literal('summarizeChat'),
  payload: z.object({
    chatId: z.string().min(1),
    days: z.number().int().min(1).max(30),
  }),
  preview: z.string().min(1).max(400),
})

export const UpdateEngagementActionSchema = z.object({
  type: z.literal('updateEngagement'),
  payload: z.object({
    chatId: z.string().min(1),
    state: z.enum(['active', 'cold']),
  }),
  preview: z.string().min(1).max(400),
})

export const ListOverviewActionSchema = z.object({
  type: z.literal('listOverview'),
  payload: z.object({
    scope: z.enum(['chats', 'schedule', 'escalations']),
  }),
  preview: z.string().min(1).max(400),
})

export const AgentActionSchema = z.discriminatedUnion('type', [
  CreateManualJobActionSchema,
  CancelManualJobsActionSchema,
  DismissEscalationActionSchema,
  SummarizeChatActionSchema,
  UpdateEngagementActionSchema,
  ListOverviewActionSchema,
])

export const AgentOutputSchema = z.object({
  thinking: z.string().max(2000),
  proposedActions: z.array(AgentActionSchema).max(5),
  clarificationNeeded: z.string().max(500).nullable(),
})

export type AgentAction = z.infer<typeof AgentActionSchema>
export type AgentActionType = AgentAction['type']
export type AgentOutput = z.infer<typeof AgentOutputSchema>

/** Mapping action.type → read-only flag (used by UI to skip confirmation). */
export const READ_ONLY_ACTIONS: Record<AgentActionType, boolean> = {
  createManualJob: false,
  cancelManualJobs: false,
  dismissEscalation: false,
  summarizeChat: true,
  updateEngagement: false,
  listOverview: true,
}

/** Persisted action row (mirror of agent_commands table). */
export interface AgentCommandRow {
  id: number
  sessionId: string
  prompt: string
  actionType: AgentActionType
  actionPayload: string
  status: 'proposed' | 'confirmed' | 'executed' | 'failed' | 'rejected'
  errorMsg: string | null
  proposedAt: number
  executedAt: number | null
}

/** Result returned by an action handler after execution. */
export interface ActionResult {
  success: boolean
  message: string
  data?: unknown
}
