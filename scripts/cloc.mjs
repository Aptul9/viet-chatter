#!/usr/bin/env node
// LOC report via cloc. Requires `cloc` on PATH (https://github.com/AlDanial/cloc).
//
// Counts only git-tracked files via `--vcs=git`, so anything in .gitignore
// (node_modules, .wwebjs_auth, logs, *.db, .next, .cache, e2e/db, ...) is
// skipped automatically. Belt-and-braces: explicit --exclude-dir / --exclude-ext
// also passed in case the repo is not a git checkout.
//
// Usage:
//   npm run loc                    # summary by language
//   npm run loc -- --by-file       # per-file breakdown
//   npm run loc -- --include-lang=TypeScript,YAML
//
// Anything after `--` is forwarded verbatim to cloc.

import { spawnSync } from 'node:child_process'

const EXCLUDE_DIRS = [
  'node_modules',
  'dist',
  'build',
  '.next',
  '.cache',
  '.wwebjs_auth',
  '.wwebjs_cache',
  'logs',
  '.git',
  'db',
].join(',')

const EXCLUDE_EXTS = ['log', 'db', 'db-journal', 'db-shm', 'db-wal', 'tsbuildinfo'].join(',')

const passthrough = process.argv.slice(2)

const args = [
  '.',
  '--vcs=git',
  `--exclude-dir=${EXCLUDE_DIRS}`,
  `--exclude-ext=${EXCLUDE_EXTS}`,
  '--not-match-d=^(\\.|_)', // also skip dotfile dirs (.idea, etc) when not in git mode
  ...passthrough,
]

const r = spawnSync('cloc', args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

if (r.error) {
  console.error('cloc not found on PATH. Install: https://github.com/AlDanial/cloc')
  process.exit(127)
}

process.exit(r.status ?? 0)
