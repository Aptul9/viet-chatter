import { NextResponse } from 'next/server'
import { getReadOnlyDb } from '@/lib/db-ro'
import { getScheduleOverview } from '@/lib/repo-bridge'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const sqlite = getReadOnlyDb()
    const overview = getScheduleOverview(sqlite)
    return NextResponse.json(overview)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
