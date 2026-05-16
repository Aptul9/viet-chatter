import { resolve, dirname, join } from 'node:path'
import { existsSync } from 'node:fs'

// `next dev ./web -p 3000` typically sets process.cwd() to the repo root
// (the directory the command was launched from), but Next.js may chdir to
// `./web` internally. We resolve the repo root by walking up until we find
// a sibling `config/` directory containing either the live YAML or the
// example.
export function repoRoot(): string {
  let dir = process.cwd()
  for (let i = 0; i < 6; i++) {
    const cfg = join(dir, 'config')
    if (
      existsSync(join(cfg, 'user-config.yaml')) ||
      existsSync(join(cfg, 'user-config.example.yaml')) ||
      existsSync(join(cfg, 'defaults.ts'))
    ) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  // Last-resort: assume cwd is repo root.
  return process.cwd()
}

export function userYamlPath(): string {
  return resolve(repoRoot(), 'config', 'user-config.yaml')
}

export function exampleYamlPath(): string {
  return resolve(repoRoot(), 'config', 'user-config.example.yaml')
}
