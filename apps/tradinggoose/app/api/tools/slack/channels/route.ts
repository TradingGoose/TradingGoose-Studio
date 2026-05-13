import { type NextRequest, NextResponse } from 'next/server'
import { resolveOAuthRouteCredential } from '@/lib/credentials/oauth-route'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('SlackChannelsAPI')

interface SlackChannel {
  id: string
  name: string
  is_private: boolean
  is_archived: boolean
  is_member: boolean
}

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()
  try {
    const body = await request.json()
    const credential = await resolveOAuthRouteCredential(request, body, requestId)
    if (!credential.ok) return credential.response

    try {
      const data = await fetchSlackChannels(credential.accessToken)
      logger.info('Successfully fetched channels including private channels')

      const channels = (data.channels || [])
        .filter(
          (channel: SlackChannel) => !channel.is_archived && (channel.is_member || !channel.is_private)
        )
        .map((channel: SlackChannel) => ({
          id: channel.id,
          name: channel.name,
          isPrivate: channel.is_private,
        }))

      logger.info(`Successfully fetched ${channels.length} Slack channels`, {
        total: data.channels?.length || 0,
        private: channels.filter((c: { isPrivate: boolean }) => c.isPrivate).length,
        public: channels.filter((c: { isPrivate: boolean }) => !c.isPrivate).length,
      })
      return NextResponse.json({ channels })
    } catch (error) {
      logger.error('Slack API error:', error)
      return NextResponse.json(
        { error: `Slack API error: ${(error as Error).message}` },
        { status: 400 }
      )
    }
  } catch (error) {
    logger.error('Error processing Slack channels request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Slack channels', details: (error as Error).message },
      { status: 500 }
    )
  }
}

async function fetchSlackChannels(accessToken: string) {
  const url = new URL('https://slack.com/api/conversations.list')
  url.searchParams.append('types', 'public_channel,private_channel')
  url.searchParams.append('exclude_archived', 'true')
  url.searchParams.append('limit', '200')

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Slack API error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()

  if (!data.ok) {
    throw new Error(data.error || 'Failed to fetch channels')
  }

  return data
}
