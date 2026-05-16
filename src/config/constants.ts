// Costanti AI fisse + nomi ENV var, fuori dal file user-facing config/index.ts
// (non hot-reloadable, vivono nel codice).

// Names of env vars opencode.ts sets on its child process.
export const ENV_OPENCODE_DISABLE_CLAUDE_CODE = 'OPENCODE_DISABLE_CLAUDE_CODE'
export const ENV_OPENCODE_DISABLE_DEFAULT_PLUGINS = 'OPENCODE_DISABLE_DEFAULT_PLUGINS'
export const ENV_OPENCODE_DISABLE_AUTOUPDATE = 'OPENCODE_DISABLE_AUTOUPDATE'
export const ENV_OPENCODE_DISABLE_LSP = 'OPENCODE_DISABLE_LSP'

// Constants consumed directly by src/ai/opencode.ts (copia da linkedin-autoapply).
export const OPENCODE_SERVER_HOST = '127.0.0.1'
export const OPENCODE_SERVER_PORT = 0
export const OPENCODE_TIMEOUT_MS = 60_000
// OPENCODE_DISABLE_CLAUDE_CODE=1: blocks the claude-code wrapper from auto-
// injecting CLAUDE.md / AGENTS.md / project skills into prompts. Safe + wanted.
export const OPENCODE_DISABLE_CLAUDE_CODE = true
// OPENCODE_DISABLE_DEFAULT_PLUGINS=1: ALSO unloads bundled provider plugins
// (github-copilot, openai, anthropic), so the HTTP /session/.../message path
// returns 500 ProviderModelNotFoundError when calling `opencode:github-copilot/...`.
// Tool isolation is already enforced by the `direct-reply` agent's deny-everything
// `permission` block in opencode.json — this env var is redundant + breaks the
// provider. Keep false. (Same bug in linkedin-autoapply config.yaml: set
// `opencode_disable_default_plugins: false`.)
export const OPENCODE_DISABLE_DEFAULT_PLUGINS = false

export const OPENCODE_AGENT_NAME = 'direct-reply'
export const OPENCODE_DEFAULT_PORT = 3456

export const EMBEDDING_DIMS = 384
export const EMBEDDING_CACHE_SIZE = 500

export const PROMPT_DIR = 'prompts/turn'

export const PRE_FIRE_OUT_RECENT_WINDOW_MS = 12 * 60 * 60_000
export const PRE_SEND_OUT_MANUAL_WINDOW_MS = 30_000
export const ONE_DAY_MS = 24 * 60 * 60_000
export const ONE_YEAR_MS = 365 * ONE_DAY_MS

export const DATE_ANCHORED_FIRE_HOUR = 9
export const DATE_ANCHORED_JITTER_MAX_MIN = 60
