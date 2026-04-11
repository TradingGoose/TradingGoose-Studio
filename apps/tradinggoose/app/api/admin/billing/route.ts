import { NextResponse } from 'next/server'
import { getSystemAdminAccess } from '@/lib/admin/access'
import { getAdminBillingSnapshot } from '@/lib/admin/billing/snapshot'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('AdminBillingAPI')

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
}

export const dynamic = 'force-dynamic'

export async function GET() {
  const requestId = generateRequestId()

  try {
    const access = await getSystemAdminAccess()
    if (!access.isAuthenticated) {
      logger.warn(`[${requestId}] Unauthorized admin billing access attempt`)
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: NO_STORE_HEADERS }
      )
    }

    const userId = access.userId
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: NO_STORE_HEADERS }
      )
    }

    if (!access.isSystemAdmin && !access.canBootstrapSystemAdmin) {
      logger.warn(`[${requestId}] Forbidden admin billing access attempt`, { userId })
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE_HEADERS })
    }

    return NextResponse.json(await getAdminBillingSnapshot(), {
      status: 200,
      headers: NO_STORE_HEADERS,
    })
  } catch (error) {
    logger.error(`[${requestId}] Failed to load admin billing snapshot`, error)
    return NextResponse.json(
      { error: 'Failed to load billing settings' },
      { status: 500, headers: NO_STORE_HEADERS }
    )
  }
}
