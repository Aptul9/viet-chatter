import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { defaults } from '../../../config/defaults.js'
import { config, __overrideConfigForTest } from '../../../src/config/index.js'
import { openDb, type Sqlite } from '../../../src/db/client.js'

export interface TestDb {
  sqlite: Sqlite
  path: string
  cleanup: () => void
}

export function openTestDb(): TestDb {
  const dir = mkdtempSync(join(tmpdir(), 'viet-chatter-test-'))
  const path = join(dir, 'test.db')
  const { sqlite } = openDb(path)
  sqlite.exec(readFileSync(resolve('drizzle/0000_init.sql'), 'utf8'))
  sqlite.exec(readFileSync(resolve('drizzle/0001_demonic_marten_broadcloak.sql'), 'utf8'))
  return {
    sqlite,
    path,
    cleanup: () => {
      try {
        sqlite.close()
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  }
}

export function overrideConfigForTest(partial: Partial<typeof defaults>): void {
  // Trigger lazy load before using the test-only override hook.
  void config.timezone
  __overrideConfigForTest(partial)
}

export function resetConfigForTest(): void {
  overrideConfigForTest(defaults)
}
