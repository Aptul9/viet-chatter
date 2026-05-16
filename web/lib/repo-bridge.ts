// Bridge to the bot's mono-file repo (Spec C, read-only surface).
//
// Re-exports the read-only helpers used by the dashboard API routes. Keeps
// the import surface explicit so dashboard code never reaches deeper into
// `src/db/repo.ts` than necessary.

export {
  listChatsWithSummary,
  getChatDetail,
  getScheduleOverview,
  getStats,
  type ChatSummaryRow,
  type ChatDetail,
  type ScheduleOverview,
  type StatsSnapshot,
} from '../../src/db/repo'
