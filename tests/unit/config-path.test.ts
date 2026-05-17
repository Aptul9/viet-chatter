import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import test from 'node:test'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { exampleYamlPath, repoRoot, userYamlPath } from '../../web/lib/config-path.js'

test('repoRoot walks up to directory containing config markers', () => {
  const oldCwd = process.cwd()
  const root = mkdtempSync(join(tmpdir(), 'viet-web-root-'))
  try {
    const cfg = join(root, 'config')
    const nested = join(root, 'web', 'app', 'api')
    mkdirSync(cfg, { recursive: true })
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(cfg, 'defaults.ts'), 'export const defaults = {}\n')

    process.chdir(nested)
    assert.equal(repoRoot(), root)
    assert.equal(userYamlPath(), resolve(root, 'config', 'user-config.yaml'))
    assert.equal(exampleYamlPath(), resolve(root, 'config', 'user-config.example.yaml'))
  } finally {
    process.chdir(oldCwd)
    rmSync(root, { recursive: true, force: true })
  }
})

test('repoRoot falls back to current cwd when no marker is found', () => {
  const oldCwd = process.cwd()
  const root = mkdtempSync(join(tmpdir(), 'viet-web-no-root-'))
  try {
    process.chdir(root)
    assert.equal(repoRoot(), root)
  } finally {
    process.chdir(oldCwd)
    rmSync(root, { recursive: true, force: true })
  }
})
