import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { dispatchFinancialMarkers } from '@/lib/billing/dispatcher'

export const dynamic = 'force-dynamic'
export const maxDuration = 55

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET?.trim())
    return NextResponse.json(
      { error: 'Financial scheduler authentication is not configured' },
      { status: 503 }
    )
  const authError = verifyCronAuth(request, 'billing dispatch')
  if (authError) return authError
  const result = await dispatchFinancialMarkers()
  return NextResponse.json({ success: true, ...result })
}
