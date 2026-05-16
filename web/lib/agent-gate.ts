// Spec D2 — Defense-in-depth gate for the AI command channel.
//
// Two checks:
//  1) env kill switch `AGENT_DISABLED=1` → 503.
//  2) Host header must be `localhost` or `127.0.0.1` (with optional port).
//     The package.json `dev:web` script binds Next.js to 127.0.0.1 already,
//     so this is a backup against config drift / `0.0.0.0` overrides.

import { NextResponse } from 'next/server'

const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export function ensureLocalhost(req: Request): NextResponse | null {
  if (process.env['AGENT_DISABLED'] === '1') {
    return NextResponse.json(
      { error: 'Agent channel disabled via AGENT_DISABLED=1.' },
      { status: 503 }
    )
  }

  const rawHost = req.headers.get('host') ?? ''
  const host = rawHost.split(':')[0]?.toLowerCase() ?? ''
  if (!ALLOWED_HOSTS.has(host)) {
    return NextResponse.json(
      {
        error:
          'Agent channel is restricted to localhost. Refusing remote/non-loopback Host header.',
      },
      { status: 403 }
    )
  }
  return null
}
