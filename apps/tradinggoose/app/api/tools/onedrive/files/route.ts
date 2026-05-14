import { type NextRequest, NextResponse } from 'next/server'
import { resolveOAuthRouteCredential } from '@/lib/credentials/oauth-route'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('OneDriveFilesAPI')

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const { searchParams } = new URL(request.url)
    const credentialId = searchParams.get('credentialId')
    const workflowId = searchParams.get('workflowId') || undefined
    const workspaceId = searchParams.get('workspaceId') || undefined
    const query = searchParams.get('query') || ''

    if (!credentialId) {
      logger.warn(`[${requestId}] Missing credential ID`)
      return NextResponse.json({ error: 'Credential ID is required' }, { status: 400 })
    }

    const credential = await resolveOAuthRouteCredential(
      request,
      { credentialId, workflowId, workspaceId },
      requestId
    )
    if (!credential.ok) return credential.response

    const searchQuery = query ? `${query} .xlsx` : '.xlsx'
    const graphParams = new URLSearchParams({
      $select:
        'id,name,mimeType,webUrl,thumbnails,createdDateTime,lastModifiedDateTime,size,createdBy',
      $top: '50',
    })

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/root/search(q='${encodeURIComponent(
        searchQuery
      )}')?${graphParams.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
        },
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
      logger.error(`[${requestId}] Microsoft Graph API error`, {
        status: response.status,
        error: errorData.error?.message || 'Failed to fetch Excel files from OneDrive',
      })
      return NextResponse.json(
        {
          error: errorData.error?.message || 'Failed to fetch Excel files from OneDrive',
        },
        { status: response.status }
      )
    }

    const data = await response.json()
    const files = (data.value || [])
      .filter(
        (file: any) =>
          file.name?.toLowerCase().endsWith('.xlsx') ||
          file.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )
      .map((file: any) => ({
        id: file.id,
        name: file.name,
        mimeType:
          file.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        iconLink: file.thumbnails?.[0]?.small?.url,
        webViewLink: file.webUrl,
        thumbnailLink: file.thumbnails?.[0]?.medium?.url,
        createdTime: file.createdDateTime,
        modifiedTime: file.lastModifiedDateTime,
        size: file.size?.toString(),
        owners: file.createdBy
          ? [
              {
                displayName: file.createdBy.user?.displayName || 'Unknown',
                emailAddress: file.createdBy.user?.email || '',
              },
            ]
          : [],
      }))

    return NextResponse.json({ files }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Excel files from OneDrive`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
