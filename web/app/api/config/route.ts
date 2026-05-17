import { NextResponse } from 'next/server'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { ConfigSchema, defaults, type ConfigShape } from '@/lib/config-schema'
import { userYamlPath, exampleYamlPath } from '@/lib/config-path'
import { mergeOverDefaults } from '@/lib/config-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const live = userYamlPath()
  const example = exampleYamlPath()
  const target = existsSync(live) ? live : existsSync(example) ? example : null

  if (!target) {
    return NextResponse.json({ config: defaults, source: 'defaults', path: live })
  }
  try {
    const raw = await readFile(target, 'utf8')
    const parsed = parseYaml(raw) as unknown
    const merged = mergeOverDefaults(parsed)
    return NextResponse.json({
      config: merged,
      source: target === live ? 'user-config.yaml' : 'user-config.example.yaml',
      path: target,
    })
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Failed to read user-config.yaml',
        details: err instanceof Error ? err.message : String(err),
        path: target,
      },
      { status: 500 }
    )
  }
}

export async function POST(req: Request) {
  const path = userYamlPath()
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const result = ConfigSchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: result.error.format() },
      { status: 400 }
    )
  }
  try {
    await mkdir(dirname(path), { recursive: true })
    const yaml = stringifyYaml(result.data, { indent: 2, lineWidth: 120 })
    await writeFile(path, yaml, 'utf8')
    return NextResponse.json({ ok: true, path })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('config write failed', err)
    return NextResponse.json(
      {
        error: 'Failed to write user-config.yaml',
        details: err instanceof Error ? err.message : String(err),
        path,
      },
      { status: 500 }
    )
  }
}
