import { AgentChat } from '@/components/dashboard/AgentChat'

export const dynamic = 'force-dynamic'

export default function AgentPage() {
  return (
    <div className="space-y-4">
      <div className="rounded border border-amber-400 bg-amber-50 p-4 text-sm">
        <strong className="block mb-1 text-amber-900">WARNING — write-capable channel</strong>
        <p className="text-amber-900">
          This page can modify the bot state (create manual jobs, mark engagement, cancel jobs). It
          is reachable only from <code>localhost</code>. Do NOT expose the dev UI in the network
          without adding real authentication. To disable, set <code>AGENT_DISABLED=1</code> in the
          environment and restart <code>next dev</code>.
        </p>
      </div>
      <header>
        <h2 className="text-lg font-semibold">Agent</h2>
        <p className="text-sm text-muted-foreground">
          Tell the AI what you want done. It proposes structured actions; you confirm before they
          run.
        </p>
      </header>
      <AgentChat />
    </div>
  )
}
