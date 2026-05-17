// Spec D2 — POST /api/dashboard/agent/execute
// Executes a previously proposed action by id. The action is loaded from
// `agent_commands`, re-validated against the strict zod union, and only
// then dispatched to the handler registry.

import { NextResponse } from 'next/server'

import { ensureLocalhost } from '@/lib/agent-gate'
import { AgentExecuteRequestSchema } from '@/lib/agent-api'

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
  const parsed = AgentExecuteRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid params', details: parsed.error.flatten() },
      { status: 400 }
    )
  }
  const { actionId } = parsed.data

  try {
    const { getAgentCommand, markAgentCommandExecuted } = await import(
      '../../../../../../src/agent/store'
    )
    const { executeAction } = await import('../../../../../../src/agent/actions')
    const { AgentActionSchema } = await import('../../../../../../src/agent/types')
    const { openWriteDb } = await import('@/lib/db-rw')

    const writeSqlite = openWriteDb()
    const row = getAgentCommand(writeSqlite, actionId)
    if (!row) return NextResponse.json({ error: 'action not found' }, { status: 404 })
    if (row.status !== 'proposed') {
      return NextResponse.json(
        { error: `action #${actionId} status=${row.status}, expected proposed` },
        { status: 409 }
      )
    }

    let payload: unknown
    try {
      payload = JSON.parse(row.actionPayload)
    } catch (err) {
      markAgentCommandExecuted(writeSqlite, actionId, false, 'payload JSON corrupted')
      return NextResponse.json(
        { error: 'stored payload corrupted', details: (err as Error).message },
        { status: 500 }
      )
    }

    const validated = AgentActionSchema.safeParse({
      type: row.actionType,
      payload,
      preview: 'rehydrated',
    })
    if (!validated.success) {
      markAgentCommandExecuted(writeSqlite, actionId, false, JSON.stringify(validated.error.flatten()))
      return NextResponse.json(
        { error: 'stored action failed re-validation', details: validated.error.flatten() },
        { status: 400 }
      )
    }

    const result = await executeAction(validated.data, writeSqlite)
    markAgentCommandExecuted(writeSqlite, actionId, result.success, result.success ? null : result.message)

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        msg: 'agent execute',
        actionId,
        type: row.actionType,
        success: result.success,
      })
    )
    return NextResponse.json({ success: result.success, message: result.message, data: result.data })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
