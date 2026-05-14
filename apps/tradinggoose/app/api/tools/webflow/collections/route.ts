import { type NextRequest, NextResponse } from 'next/server'
import { resolveOAuthRouteCredential } from '@/lib/credentials/oauth-route'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('WebflowCollectionsAPI')

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const { searchParams } = new URL(request.url)
    const siteId = searchParams.get('siteId')
    const credentialId = searchParams.get('credentialId')
    const workflowId = searchParams.get('workflowId') || undefined
    const workspaceId = searchParams.get('workspaceId') || undefined

    if (!siteId) {
      return NextResponse.json({ error: 'Missing siteId parameter' }, { status: 400 })
    }
    if (!credentialId) {
      return NextResponse.json({ error: 'Missing credentialId parameter' }, { status: 400 })
    }

    const credential = await resolveOAuthRouteCredential(
      request,
      { credentialId, workflowId, workspaceId },
      requestId
    )
    if (!credential.ok) return credential.response

    const response = await fetch(`https://api.webflow.com/v2/sites/${siteId}/collections`, {
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        accept: 'application/json',
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      logger.error('Failed to fetch Webflow collections', {
        status: response.status,
        error: errorData,
        siteId,
      })
      return NextResponse.json(
        { error: 'Failed to fetch Webflow collections', details: errorData },
        { status: response.status }
      )
    }

    const data = await response.json()
    const collections = data.collections || []

    const formattedCollections = collections.map((collection: any) => ({
      id: collection.id,
      name: collection.displayName || collection.slug || collection.id,
    }))

    return NextResponse.json({ collections: formattedCollections }, { status: 200 })
  } catch (error: any) {
    logger.error('Error fetching Webflow collections', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}
