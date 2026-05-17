import assert from 'node:assert/strict'
import test from 'node:test'

import { ensureLocalhost } from '../../web/lib/agent-gate.js'

test('agent gate allows localhost host headers', () => {
  delete process.env['AGENT_DISABLED']
  const req = new Request('http://127.0.0.1/api/dashboard/agent', {
    headers: { host: '127.0.0.1:3000' },
  })
  assert.equal(ensureLocalhost(req), null)
})

test('agent gate rejects non-loopback host headers', () => {
  delete process.env['AGENT_DISABLED']
  const req = new Request('http://evil.example/api/dashboard/agent', {
    headers: { host: 'evil.example' },
  })
  assert.equal(ensureLocalhost(req)?.status, 403)
})

test('agent gate kill switch wins before host validation', () => {
  process.env['AGENT_DISABLED'] = '1'
  try {
    const req = new Request('http://evil.example/api/dashboard/agent', {
      headers: { host: 'evil.example' },
    })
    assert.equal(ensureLocalhost(req)?.status, 503)
  } finally {
    delete process.env['AGENT_DISABLED']
  }
})
