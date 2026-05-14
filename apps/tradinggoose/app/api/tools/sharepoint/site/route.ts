import { randomUUID } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { resolveOAuthRouteCredential } from '@/lib/credentials/oauth-route'
import { createLogger } from '@/lib/logs/console/logger'
import { validateMicrosoftGraphId } from '@/lib/security/input-validation'

export const dynamic = 'force-dynamic'

const logger = createLogger('SharePointSiteAPI')

export async function GET(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)

  try {
    const { searchParams } = new URL(request.url)
    const credentialId = searchParams.get('credentialId')
    const workflowId = searchParams.get('workflowId') || undefined
    const workspaceId = searchParams.get('workspaceId') || undefined
    const siteId = searchParams.get('siteId')

    if (!credentialId || !siteId) {
      return NextResponse.json({ error: 'Credential ID and Site ID are required' }, { status: 400 })
    }

    const siteIdValidation = validateMicrosoftGraphId(siteId, 'siteId')
    if (!siteIdValidation.isValid) {
      return NextResponse.json({ error: siteIdValidation.error }, { status: 400 })
    }

    const credential = await resolveOAuthRouteCredential(
      request,
      { credentialId, workflowId, workspaceId },
      requestId
    )
    if (!credential.ok) return credential.response

    let endpoint: string
    if (siteId === 'root') {
      endpoint = 'sites/root'
    } else if (siteId.includes(':')) {
      endpoint = `sites/${siteId}`
    } else if (siteId.includes('groups/')) {
      endpoint = siteId
    } else {
      endpoint = `sites/${siteId}`
    }

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/${endpoint}?$select=id,name,displayName,webUrl,createdDateTime,lastModifiedDateTime`,
      {
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
        },
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
      return NextResponse.json(
        { error: errorData.error?.message || 'Failed to fetch site from SharePoint' },
        { status: response.status }
      )
    }

    const site = await response.json()

    const transformedSite = {
      id: site.id,
      name: site.displayName || site.name,
      mimeType: 'application/vnd.microsoft.graph.site',
      webViewLink: site.webUrl,
      createdTime: site.createdDateTime,
      modifiedTime: site.lastModifiedDateTime,
    }

    logger.info(`[${requestId}] Successfully fetched SharePoint site: ${transformedSite.name}`)
    return NextResponse.json({ site: transformedSite }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching site from SharePoint`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
