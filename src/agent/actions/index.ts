// Spec D2 — Action handler registry. Maps `action.type` → executor.

import type { Sqlite } from '../../db/client.js'
import type { ActionResult, AgentAction, AgentActionType } from '../types.js'
import { executeCreateManualJob } from './create-manual-job.js'
import { executeCancelManualJobs } from './cancel-manual-jobs.js'
import { executeDismissEscalation } from './dismiss-escalation.js'
import { executeSummarizeChat } from './summarize-chat.js'
import { executeUpdateEngagement } from './update-engagement.js'
import { executeListOverview } from './list-overview.js'
import { executeRunReadOnlySql } from './run-read-only-sql.js'

export type ActionExecutor = (action: AgentAction, sqlite: Sqlite) => Promise<ActionResult>

const REGISTRY: Record<AgentActionType, ActionExecutor> = {
  createManualJob: (a, db) =>
    a.type === 'createManualJob' ? executeCreateManualJob(a.payload, db) : invalid(a.type),
  cancelManualJobs: (a, db) =>
    a.type === 'cancelManualJobs' ? executeCancelManualJobs(a.payload, db) : invalid(a.type),
  dismissEscalation: (a, db) =>
    a.type === 'dismissEscalation' ? executeDismissEscalation(a.payload, db) : invalid(a.type),
  summarizeChat: (a, db) =>
    a.type === 'summarizeChat' ? executeSummarizeChat(a.payload, db) : invalid(a.type),
  updateEngagement: (a, db) =>
    a.type === 'updateEngagement' ? executeUpdateEngagement(a.payload, db) : invalid(a.type),
  listOverview: (a, db) =>
    a.type === 'listOverview' ? executeListOverview(a.payload, db) : invalid(a.type),
  runReadOnlySql: (a, db) =>
    a.type === 'runReadOnlySql' ? executeRunReadOnlySql(a.payload, db) : invalid(a.type),
}

async function invalid(type: string): Promise<ActionResult> {
  return { success: false, message: `dispatch mismatch for action type "${type}"` }
}

export async function executeAction(action: AgentAction, sqlite: Sqlite): Promise<ActionResult> {
  const exec = REGISTRY[action.type]
  if (!exec) return { success: false, message: `unknown action type ${action.type}` }
  try {
    return await exec(action, sqlite)
  } catch (err) {
    return {
      success: false,
      message: `action threw: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
