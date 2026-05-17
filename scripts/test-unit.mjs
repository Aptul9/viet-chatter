import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOTS = ['tests']
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.git'])

function collect(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const path = join(dir, entry)
    const st = statSync(path)
    if (st.isDirectory()) out.push(...collect(path))
    else if (entry.endsWith('.test.ts')) out.push(path)
  }
  return out
}

const files = ROOTS.flatMap((root) => collect(root)).map((p) => relative(process.cwd(), p))

if (files.length === 0) {
  console.error('No unit test files found under tests/**/*.test.ts')
  process.exit(2)
}

const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'test' },
  shell: false,
})

process.exit(result.status ?? 1)
