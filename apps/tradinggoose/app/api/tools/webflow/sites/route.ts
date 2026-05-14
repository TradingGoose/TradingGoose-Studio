import { type NextRequest, NextResponse } from 'next/server'
import { resolveOAuthRouteCredential } from '@/lib/credentials/oauth-route'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('WebflowSitesAPI')

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const { searchParams } = new URL(request.url)
    const credentialId = searchParams.get('credentialId')
    const workflowId = searchParams.get('workflowId') || undefined
    const workspaceId = searchParams.get('workspaceId') || undefined
    if (!credentialId) {
      return NextResponse.json({ error: 'Missing credentialId parameter' }, { status: 400 })
    }

    const credential = await resolveOAuthRouteCredential(
      request,
      { credentialId, workflowId, workspaceId },
      requestId
    )
    if (!credential.ok) return credential.response

    const response = await fetch('https://api.webflow.com/v2/sites', {
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        accept: 'application/json',
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      logger.error('Failed to fetch Webflow sites', {
        status: response.status,
        error: errorData,
      })
      return NextResponse.json(
        { error: 'Failed to fetch Webflow sites', details: errorData },
        { status: response.status }
      )
    }

    const data = await response.json()
    const sites = data.sites || []

    const formattedSites = sites.map((site: any) => ({
      id: site.id,
      name: site.displayName || site.shortName || site.id,
    }))

    return NextResponse.json({ sites: formattedSites }, { status: 200 })
  } catch (error: any) {
    logger.error('Error fetching Webflow sites', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}
