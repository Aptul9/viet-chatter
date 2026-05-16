// Scenario types for the mock-based e2e harness (Spec B, C side).
//
// Each scenario gets its own bootstrapped `TestDeps` (DB, state machine,
// dispatcher, orchestrator, fake WhatsApp handle, AI stub control) and
// returns a structured result. The registry runs them sequentially and
// aggregates pass/fail.

import type { Sqlite } from '../../db/client.js'
import type { MessageDispatcher } from '../../dispatcher/index.js'
import type { ReplyOrchestrator } from '../../orchestrator/index.js'
import type { ChatStateMachine } from '../../scheduler/state.js'
import type { InflightRegistry } from '../../orchestrator/inflight.js'
import type { MediaQueue } from '../../orchestrator/media-queue.js'
import type { EscalationNotifier } from '../../escalation/notifier.js'
import type { WhatsAppHandle } from '../../whatsapp/client.js'

/** Captured fake `sendMessage` payload — what the bot would have sent. */
export interface CapturedSend {
  chatId: string
  text: string
  ts: number
}

/** Test-time controls over the AI stub (env-var-driven). */
export interface AiStubControl {
  /** Set the canned JSON the router will return for the NEXT call. */
  setNextResponse(json: string): void
  /** Clear the stub (router will fail or fall back to real provider). */
  reset(): void
}

/** Bootstrapped resources for a single scenario. */
export interface TestDeps {
  sqlite: Sqlite
  wa: WhatsAppHandle
  dispatcher: MessageDispatcher
  orchestrator: ReplyOrchestrator
  state: ChatStateMachine
  inflight: InflightRegistry
  mediaQueue: MediaQueue
  escalationNotifier: EscalationNotifier
  /** Append-only capture of every fake `sendMessage` call. */
  sent: CapturedSend[]
  /** AI stub remote control. */
  ai: AiStubControl
  /** Per-scenario chat id (synthetic E.164 with @c.us). */
  chatId: string
}

/** Result returned by a scenario's `run` function. */
export interface ScenarioResult {
  ok: boolean
  errors: string[]
  notes?: string[]
}

export interface Scenario {
  name: string
  description: string
  /** Run the scenario against an already-bootstrapped TestDeps. */
  run(deps: TestDeps): Promise<ScenarioResult>
}
