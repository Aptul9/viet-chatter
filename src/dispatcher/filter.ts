// Thin wrapper over the live `shouldReply` predicate exported by
// `src/config/index.ts`. The config loader handles hot-reload + zod re-validation
// (see docs/dev/11-config-and-hot-reload.md). This file exists so other modules
// import `applyFilter` from a stable path that does not depend on the user-facing
// `config/index.ts` shape.

import { shouldReply } from '../config/index.js'
import type { ChatContext } from '../types.js'

export function applyFilter(ctx: ChatContext): boolean {
  return shouldReply(ctx)
}
