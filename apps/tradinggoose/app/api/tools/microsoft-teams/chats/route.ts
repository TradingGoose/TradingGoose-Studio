import { type NextRequest, NextResponse } from 'next/server'
import { resolveOAuthRouteCredential } from '@/lib/credentials/oauth-route'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('TeamsChatsAPI')

// Helper function to get chat members and create a meaningful name
const getChatDisplayName = async (
  chatId: string,
  accessToken: string,
  chatTopic?: string
): Promise<string> => {
  try {
    // If the chat already has a topic, use it
    if (chatTopic?.trim() && chatTopic !== 'null') {
      return chatTopic
    }

    // Fetch chat members to create a meaningful name
    const membersResponse = await fetch(
      `https://graph.microsoft.com/v1.0/chats/${chatId}/members`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (membersResponse.ok) {
      const membersData = await membersResponse.json()
      const members = membersData.value || []

      // Filter out the current user and get display names
      const memberNames = members
        .filter((member: any) => member.displayName && member.displayName !== 'Unknown')
        .map((member: any) => member.displayName)
        .slice(0, 3) // Limit to first 3 names to avoid very long names

      if (memberNames.length > 0) {
        if (memberNames.length === 1) {
          return memberNames[0] // 1:1 chat
        }
        if (memberNames.length === 2) {
          return memberNames.join(' & ') // 2-person group
        }
        return `${memberNames.slice(0, 2).join(', ')} & ${memberNames.length - 2} more` // Larger group
      }
    }

    // Fallback: try to get a better name from recent messages
    try {
      const messagesResponse = await fetch(
        `https://graph.microsoft.com/v1.0/chats/${chatId}/messages?$top=10&$orderby=createdDateTime desc`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      )

      if (messagesResponse.ok) {
        const messagesData = await messagesResponse.json()
        const messages = messagesData.value || []

        // Look for chat rename events
        for (const message of messages) {
          if (message.eventDetail?.chatDisplayName) {
            return message.eventDetail.chatDisplayName
          }
        }

        // Get unique sender names from recent messages as last resort
        const senderNames = [
          ...new Set(
            messages
              .filter(
                (msg: any) => msg.from?.user?.displayName && msg.from.user.displayName !== 'Unknown'
              )
              .map((msg: any) => msg.from.user.displayName)
          ),
        ].slice(0, 3)

        if (senderNames.length > 0) {
          if (senderNames.length === 1) {
            return senderNames[0] as string
          }
          if (senderNames.length === 2) {
            return senderNames.join(' & ')
          }
          return `${senderNames.slice(0, 2).join(', ')} & ${senderNames.length - 2} more`
        }
      }
    } catch (error) {
      logger.warn(
        `Failed to get better name from messages for chat ${chatId}: ${error instanceof Error ? error.message : String(error)}`
      )
    }

    // Final fallback
    return `Chat ${chatId.split(':')[0] || chatId.substring(0, 8)}...`
  } catch (error) {
    logger.warn(
      `Failed to get display name for chat ${chatId}: ${error instanceof Error ? error.message : String(error)}`
    )
    return `Chat ${chatId.split(':')[0] || chatId.substring(0, 8)}...`
  }
}

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()
  try {
    const body = await request.json()
    const credential = await resolveOAuthRouteCredential(request, body, requestId)
    if (!credential.ok) return credential.response

    const response = await fetch('https://graph.microsoft.com/v1.0/me/chats', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      logger.error('Microsoft Graph API error getting chats', {
        status: response.status,
        error: errorData,
        endpoint: 'https://graph.microsoft.com/v1.0/me/chats',
      })
      return NextResponse.json(
        { error: errorData.error?.message || 'Failed to retrieve Microsoft Teams chats' },
        { status: response.status }
      )
    }

    const data = await response.json()

    const chats = await Promise.all(
      data.value.map(async (chat: any) => ({
        id: chat.id,
        displayName: await getChatDisplayName(chat.id, credential.accessToken, chat.topic),
      }))
    )

    return NextResponse.json({ chats })
  } catch (error) {
    logger.error('Error processing Chats request:', error)
    return NextResponse.json(
      {
        error: 'Failed to retrieve Microsoft Teams chats',
        details: (error as Error).message,
      },
      { status: 500 }
    )
  }
}
