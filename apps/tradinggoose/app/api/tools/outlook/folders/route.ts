import { type NextRequest, NextResponse } from 'next/server'
import { resolveOAuthRouteCredential } from '@/lib/credentials/oauth-route'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('OutlookFoldersAPI')

interface OutlookFolder {
  id: string
  displayName: string
  totalItemCount?: number
  unreadItemCount?: number
}

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const { searchParams } = new URL(request.url)
    const credentialId = searchParams.get('credentialId')
    const workflowId = searchParams.get('workflowId') || undefined
    const workspaceId = searchParams.get('workspaceId') || undefined
    const folderId = searchParams.get('folderId')

    if (!credentialId) {
      logger.error('Missing credentialId in request')
      return NextResponse.json({ error: 'Credential ID is required' }, { status: 400 })
    }

    try {
      const credential = await resolveOAuthRouteCredential(
        request,
        {
          credentialId,
          workflowId,
          workspaceId,
        },
        requestId
      )
      if (!credential.ok) return credential.response

      const graphPath = folderId
        ? `https://graph.microsoft.com/v1.0/me/mailFolders/${encodeURIComponent(folderId)}`
        : 'https://graph.microsoft.com/v1.0/me/mailFolders'

      const response = await fetch(graphPath, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const errorData = await response.json()
        logger.error('Microsoft Graph API error getting folders', {
          status: response.status,
          error: errorData,
          endpoint: graphPath,
        })

        if (response.status === 401) {
          return NextResponse.json(
            {
              error: 'Authentication failed. Please reconnect your Outlook account.',
              authRequired: true,
            },
            { status: 401 }
          )
        }

        throw new Error(`Microsoft Graph API error: ${JSON.stringify(errorData)}`)
      }

      if (folderId) {
        const folder: OutlookFolder = await response.json()
        return NextResponse.json({
          folder: {
            id: folder.id,
            name: folder.displayName,
            type: 'folder',
            messagesTotal: folder.totalItemCount || 0,
            messagesUnread: folder.unreadItemCount || 0,
          },
        })
      }

      const data = await response.json()
      const folders = data.value || []

      return NextResponse.json({
        folders: folders.map((folder: OutlookFolder) => ({
          id: folder.id,
          name: folder.displayName,
          type: 'folder',
          messagesTotal: folder.totalItemCount || 0,
          messagesUnread: folder.unreadItemCount || 0,
        })),
      })
    } catch (innerError) {
      logger.error('Error during API requests:', innerError)

      // Check if it's an authentication error
      const errorMessage = innerError instanceof Error ? innerError.message : String(innerError)
      if (
        errorMessage.includes('auth') ||
        errorMessage.includes('token') ||
        errorMessage.includes('unauthorized') ||
        errorMessage.includes('unauthenticated')
      ) {
        return NextResponse.json(
          {
            error: 'Authentication failed. Please reconnect your Outlook account.',
            authRequired: true,
            details: errorMessage,
          },
          { status: 401 }
        )
      }

      throw innerError
    }
  } catch (error) {
    logger.error('Error processing Outlook folders request:', error)
    return NextResponse.json(
      {
        error: 'Failed to retrieve Outlook folders',
        details: (error as Error).message,
      },
      { status: 500 }
    )
  }
}
