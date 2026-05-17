// Scenario registry for the mock-based e2e harness (Spec B, C side).
// Add new scenarios here.

import { audioEscalation } from './audio-escalation.js'
import { basicReply } from './basic-reply.js'
import { dateAnchoredJob } from './date-anchored-job.js'
import { escalationOutput } from './escalation-output.js'
import { failureTrackerAlert } from './failure-tracker-alert.js'
import { imageEscalationFallback } from './image-escalation-fallback.js'
import { imageVision } from './image-vision.js'
import { retryReactiveBackoff } from './retry-reactive-backoff.js'
import { retryReactiveRecovery } from './retry-reactive-recovery.js'
import { skipOutput } from './skip-output.js'
import type { Scenario } from './types.js'

export const SCENARIOS: Scenario[] = [
  basicReply,
  imageVision,
  imageEscalationFallback,
  audioEscalation,
  skipOutput,
  escalationOutput,
  dateAnchoredJob,
  retryReactiveBackoff,
  retryReactiveRecovery,
  failureTrackerAlert,
]

export const SCENARIO_BY_NAME = new Map<string, Scenario>(SCENARIOS.map((s) => [s.name, s]))

export type { Scenario } from './types.js'
