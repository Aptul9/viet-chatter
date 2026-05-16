import { NextResponse } from 'next/server'
import { getReadOnlyDb } from '@/lib/db-ro'
import { getStats } from '@/lib/repo-bridge'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const RANGES = new Set(['24h', '7d', 'all'])

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const rawRange = url.searchParams.get('range') ?? '24h'
    const range = (RANGES.has(rawRange) ? rawRange : '24h') as '24h' | '7d' | 'all'
    const sqlite = getReadOnlyDb()
    const snapshot = getStats(sqlite, range)
    return NextResponse.json(snapshot)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
