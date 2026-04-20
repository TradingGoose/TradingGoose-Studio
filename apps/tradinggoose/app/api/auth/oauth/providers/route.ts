import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { getOAuthProviderAvailability } from '@/lib/oauth/provider-availability.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('OAuthProvidersAPI')

export async function GET(request: NextRequest) {
  const providersParam = request.nextUrl.searchParams.get('providers')
  const providers = providersParam
    ? providersParam
        .split(',')
        .map((provider) => provider.trim())
        .filter(Boolean)
    : []

  try {
    return NextResponse.json(await getOAuthProviderAvailability(providers))
  } catch (error) {
    logger.error('Failed to load OAuth provider availability', error)
    return NextResponse.json({})
  }
}
