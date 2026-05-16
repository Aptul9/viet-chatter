import { NextResponse } from 'next/server'
import { getReadOnlyDb } from '@/lib/db-ro'
import { getChatDetail } from '@/lib/repo-bridge'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: Request, ctx: { params: Promise<{ chatId: string }> }) {
  try {
    const { chatId } = await ctx.params
    const decoded = decodeURIComponent(chatId)
    const sqlite = getReadOnlyDb()
    const detail = getChatDetail(sqlite, decoded)
    return NextResponse.json({ chatId: decoded, ...detail })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
