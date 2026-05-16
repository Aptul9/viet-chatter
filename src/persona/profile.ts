// CRUD on `person_profile`, plus JSON (de)serialization for the `languages`
// column. Thin wrappers over repo.ts that hide the JSON-string boundary so
// callers see clean string[] arrays.

import type { Sqlite } from '../db/client.js'
import {
  getPersonProfile as repoGetPersonProfile,
  upsertPersonProfile as repoUpsertPersonProfile,
  updateToneSummary as repoUpdateToneSummary,
  updateLanguages as repoUpdateLanguages,
  setEngagementState as repoSetEngagementState,
} from '../db/repo.js'
import type { ChatId, EngagementState, PersonProfileRow, PersonProfileUpsert } from '../types.js'

const DEFAULT_LANGUAGES: ReadonlyArray<string> = ['en']

export function getProfile(sqlite: Sqlite, chatId: ChatId): PersonProfileRow | null {
  return repoGetPersonProfile(sqlite, chatId)
}

export function getOrInitProfile(sqlite: Sqlite, chatId: ChatId, now: number): PersonProfileRow {
  const existing = repoGetPersonProfile(sqlite, chatId)
  if (existing) return existing
  const init: PersonProfileUpsert = {
    chatId,
    displayName: null,
    languages: [...DEFAULT_LANGUAGES],
    toneSummary: null,
    reEngageThresholdDays: 14,
    engagementState: 'active',
    createdAt: now,
    updatedAt: now,
  }
  repoUpsertPersonProfile(sqlite, init)
  const fresh = repoGetPersonProfile(sqlite, chatId)
  if (!fresh) throw new Error(`person_profile upsert failed for ${chatId}`)
  return fresh
}

export function upsertProfile(sqlite: Sqlite, row: PersonProfileUpsert): void {
  repoUpsertPersonProfile(sqlite, row)
}

export function updateTone(sqlite: Sqlite, chatId: ChatId, toneSummary: string | null): void {
  repoUpdateToneSummary(sqlite, chatId, toneSummary)
}

export function updateLanguages(sqlite: Sqlite, chatId: ChatId, languages: string[]): void {
  repoUpdateLanguages(sqlite, chatId, languages)
}

export function setEngagement(sqlite: Sqlite, chatId: ChatId, state: EngagementState): void {
  repoSetEngagementState(sqlite, chatId, state)
}
