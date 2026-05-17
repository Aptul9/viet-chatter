import assert from 'node:assert/strict'
import test from 'node:test'

import { getEscalation } from '../../src/db/repo.js'
import { escalateMedia } from '../../src/escalation/from-media.js'
import { openTestDb } from './helpers/test-db.js'

test('media escalation creates pending row with templated summary and triggers notify', async () => {
  const db = openTestDb()
  try {
    let notifiedId: number | null = null
    const escId = escalateMedia({
      sqlite: db.sqlite,
      notifier: { notify: async (id: number) => void (notifiedId = id) } as never,
      chatId: '391111111111@c.us',
      triggerMsgId: 'msg-1',
      mediaType: 'audio',
      caption: 'listen later',
      displayName: 'Hoa',
    })

    await new Promise((resolve) => setImmediate(resolve))

    const esc = getEscalation(db.sqlite, escId)
    assert.equal(notifiedId, escId)
    assert.equal(esc?.status, 'pending')
    assert.match(esc?.summary ?? '', /Messaggio audio ricevuto da Hoa\./)
    assert.match(esc?.summary ?? '', /Didascalia: "listen later"/)
  } finally {
    db.cleanup()
  }
})
