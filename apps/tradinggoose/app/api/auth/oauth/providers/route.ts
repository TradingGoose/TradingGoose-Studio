import { type NextRequest, NextResponse } from 'next/server'
import { getOAuthProviderAvailability } from '@/lib/oauth/oauth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const providersParam = request.nextUrl.searchParams.get('providers')
  const providers = providersParam
    ? providersParam
        .split(',')
        .map((provider) => provider.trim())
        .filter(Boolean)
    : []

  return NextResponse.json(getOAuthProviderAvailability(providers))
}
