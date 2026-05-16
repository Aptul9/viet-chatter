// Spec D2 — Action: read-only overview snapshot.

import type { Sqlite } from '../../db/client.js'
import { getScheduleOverview, listChatsWithSummary } from '../../db/repo.js'
import type { ActionResult } from '../types.js'

export interface ListOverviewPayload {
  scope: 'chats' | 'schedule' | 'escalations'
}

export async function executeListOverview(
  payload: ListOverviewPayload,
  sqlite: Sqlite
): Promise<ActionResult> {
  switch (payload.scope) {
    case 'chats': {
      const chats = listChatsWithSummary(sqlite).slice(0, 30)
      return {
        success: true,
        message: `Top ${chats.length} chats by recent activity.`,
        data: { chats },
      }
    }
    case 'schedule': {
      const overview = getScheduleOverview(sqlite)
      return {
        success: true,
        message: `${overview.chatStates.length} active states, ${overview.manualJobs.length} pending jobs, ${overview.escalations.length} pending escalations.`,
        data: overview,
      }
    }
    case 'escalations': {
      const overview = getScheduleOverview(sqlite)
      return {
        success: true,
        message: `${overview.escalations.length} pending escalations.`,
        data: { escalations: overview.escalations },
      }
    }
  }
}
