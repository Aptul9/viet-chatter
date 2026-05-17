// Spec D2 — POST /api/dashboard/agent
// Validates owner prompt, runs the planning AI, persists each proposed
// action as `agent_commands` row(s) with status='proposed', returns the
// list to the UI for confirm-or-cancel.
//
// Security: localhost-only binding enforced + kill switch env + audit log.

import { NextResponse } from 'next/server'

import { getReadOnlyDb } from '@/lib/db-ro'
import { ensureLocalhost } from '@/lib/agent-gate'
import { AgentRouteRequestSchema } from '@/lib/agent-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const gateResp = ensureLocalhost(req)
  if (gateResp) return gateResp

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const parsed = AgentRouteRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid params', details: parsed.error.flatten() },
      { status: 400 }
    )
  }
  const { sessionId, prompt, history } = parsed.data

  // Lazy-import the bot agent pipeline so the web build never bundles it
  // unless an actual agent request comes in.
  let proposed: Array<{
    id: number
    type: string
    payload: unknown
    preview: string
    isReadOnly: boolean
  }>
  let thinking: string
  let clarificationNeeded: string | null
  let writeSqlite: import('better-sqlite3').Database
  try {
    const { buildAgentContext } = await import('../../../../../src/agent/context')
    const { generateAgentTurn } = await import('../../../../../src/agent/turn')
    const { insertAgentCommand } = await import('../../../../../src/agent/store')
    const { READ_ONLY_ACTIONS } = await import('../../../../../src/agent/types')
    const { openWriteDb } = await import('@/lib/db-rw')

    const sqliteRo = getReadOnlyDb()
    const ctx = buildAgentContext(sqliteRo)
    const out = await generateAgentTurn(prompt, ctx, history ?? [])
    if (!out) {
      return NextResponse.json({ error: 'AI returned no usable plan' }, { status: 502 })
    }

    writeSqlite = openWriteDb()
    const now = Date.now()
    proposed = out.proposedActions.map((a) => {
      const id = insertAgentCommand(writeSqlite, {
        sessionId,
        prompt,
        actionType: a.type,
        actionPayload: a.payload,
        proposedAt: now,
      })
      return {
        id,
        type: a.type,
        payload: a.payload,
        preview: a.preview,
        isReadOnly: READ_ONLY_ACTIONS[a.type] === true,
      }
    })
    thinking = out.thinking
    clarificationNeeded = out.clarificationNeeded
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      msg: 'agent propose',
      sessionId,
      promptChars: prompt.length,
      actionCount: proposed.length,
      hasClarification: clarificationNeeded != null,
    })
  )
  return NextResponse.json({ thinking, clarificationNeeded, actions: proposed })
}
