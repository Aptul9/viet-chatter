import assert from 'node:assert/strict'
import test from 'node:test'

import { applyFilter } from '../../src/dispatcher/filter.js'
import { overrideConfigForTest, resetConfigForTest } from './helpers/test-db.js'

test('filter enforces prefix, blocklist, saved-contact, and unread gates', () => {
  resetConfigForTest()
  overrideConfigForTest({
    filter: {
      allowedPrefixes: ['+84'],
      blockedNumbers: ['+841234'],
      savedContactsOnly: true,
      unreadOnly: true,
    },
  })

  assert.equal(
    applyFilter({
      phone: '+39123',
      name: 'x',
      isSavedContact: true,
      lastMessageTs: 0,
      unreadCount: 1,
    }),
    false
  )
  assert.equal(
    applyFilter({
      phone: '+841234',
      name: 'x',
      isSavedContact: true,
      lastMessageTs: 0,
      unreadCount: 1,
    }),
    false
  )
  assert.equal(
    applyFilter({
      phone: '+84999',
      name: 'x',
      isSavedContact: false,
      lastMessageTs: 0,
      unreadCount: 1,
    }),
    false
  )
  assert.equal(
    applyFilter({
      phone: '+84999',
      name: 'x',
      isSavedContact: true,
      lastMessageTs: 0,
      unreadCount: 0,
    }),
    false
  )
  assert.equal(
    applyFilter({
      phone: '+84999',
      name: 'x',
      isSavedContact: true,
      lastMessageTs: 0,
      unreadCount: 2,
    }),
    true
  )
})

test('empty allowedPrefixes removes prefix gate', () => {
  resetConfigForTest()
  overrideConfigForTest({
    filter: {
      allowedPrefixes: [],
      blockedNumbers: [],
      savedContactsOnly: false,
      unreadOnly: false,
    },
  })

  assert.equal(
    applyFilter({
      phone: '+39123',
      name: undefined,
      isSavedContact: false,
      lastMessageTs: 0,
      unreadCount: 0,
    }),
    true
  )
})
