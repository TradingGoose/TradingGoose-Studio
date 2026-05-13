import { type NextRequest, NextResponse } from 'next/server'
import { resolveOAuthRouteCredential } from '@/lib/credentials/oauth-route'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('TeamsChannelsAPI')

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()
  try {
    const body = await request.json()
    const { teamId } = body

    if (!teamId) {
      logger.error('Missing team ID in request')
      return NextResponse.json({ error: 'Team ID is required' }, { status: 400 })
    }

    const credential = await resolveOAuthRouteCredential(request, body, requestId)
    if (!credential.ok) return credential.response

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(teamId)}/channels`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      logger.error('Microsoft Graph API error getting channels', {
        status: response.status,
        error: errorData,
        endpoint: `https://graph.microsoft.com/v1.0/teams/${teamId}/channels`,
      })
      return NextResponse.json(
        { error: errorData.error?.message || 'Failed to retrieve Microsoft Teams channels' },
        { status: response.status }
      )
    }

    const data = await response.json()

    return NextResponse.json({ channels: data.value })
  } catch (error) {
    logger.error('Error processing Channels request:', error)
    return NextResponse.json(
      {
        error: 'Failed to retrieve Microsoft Teams channels',
        details: (error as Error).message,
      },
      { status: 500 }
    )
  }
}
