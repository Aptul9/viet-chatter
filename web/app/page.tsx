import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'

import { defaults, type ConfigShape } from '@/lib/config-schema'
import { userYamlPath, exampleYamlPath } from '@/lib/config-path'
import { ConfigForm } from '@/components/config-form'

export const dynamic = 'force-dynamic'

function mergeOverDefaults(parsed: unknown): ConfigShape {
  const p = (parsed ?? {}) as Record<string, unknown>
  return {
    ...defaults,
    ...p,
    nightWindow: { ...defaults.nightWindow, ...((p.nightWindow as object) ?? {}) },
    postReconnectSpreadMs: {
      ...defaults.postReconnectSpreadMs,
      ...((p.postReconnectSpreadMs as object) ?? {}),
    },
    escalation: { ...defaults.escalation, ...((p.escalation as object) ?? {}) },
    filter: { ...defaults.filter, ...((p.filter as object) ?? {}) },
  } as ConfigShape
}

async function loadInitial(): Promise<{ initial: ConfigShape; source: string; path: string }> {
  const live = userYamlPath()
  const example = exampleYamlPath()
  const target = existsSync(live) ? live : existsSync(example) ? example : null
  if (!target) {
    return { initial: defaults, source: 'defaults', path: live }
  }
  try {
    const raw = await readFile(target, 'utf8')
    const parsed = parseYaml(raw) as unknown
    const merged = mergeOverDefaults(parsed)
    return {
      initial: merged,
      source: target === live ? 'user-config.yaml' : 'user-config.example.yaml',
      path: target,
    }
  } catch {
    return { initial: defaults, source: 'defaults (yaml read failed)', path: target }
  }
}

export default async function Page() {
  const { initial, source, path } = await loadInitial()
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8 space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">viet-chatter</h1>
        <p className="text-sm text-muted-foreground">
          Runtime configuration. Saving writes to <code>config/user-config.yaml</code> at the repo
          root. The bot hot-reloads on file change.
        </p>
      </header>
      <ConfigForm initial={initial} source={source} path={path} />
    </main>
  )
}
