import { NextResponse } from 'next/server'
import { getReadOnlyDb } from '@/lib/db-ro'
import { listChatsWithSummary } from '@/lib/repo-bridge'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const sqlite = getReadOnlyDb()
    const chats = listChatsWithSummary(sqlite)
    return NextResponse.json({ chats })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
