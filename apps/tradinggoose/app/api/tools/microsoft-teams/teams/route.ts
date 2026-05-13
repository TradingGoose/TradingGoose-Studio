import { type NextRequest, NextResponse } from 'next/server'
import { resolveOAuthRouteCredential } from '@/lib/credentials/oauth-route'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('TeamsTeamsAPI')

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()
  try {
    const body = await request.json()
    const credential = await resolveOAuthRouteCredential(request, body, requestId)
    if (!credential.ok) return credential.response

    const response = await fetch('https://graph.microsoft.com/v1.0/me/joinedTeams', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      logger.error('Microsoft Graph API error getting teams', {
        status: response.status,
        error: errorData,
        endpoint: 'https://graph.microsoft.com/v1.0/me/joinedTeams',
      })
      return NextResponse.json(
        { error: errorData.error?.message || 'Failed to retrieve Microsoft Teams teams' },
        { status: response.status }
      )
    }

    const data = await response.json()

    return NextResponse.json({ teams: data.value })
  } catch (error) {
    logger.error('Error processing Teams request:', error)
    return NextResponse.json(
      {
        error: 'Failed to retrieve Microsoft Teams teams',
        details: (error as Error).message,
      },
      { status: 500 }
    )
  }
}
