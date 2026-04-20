import { type NextRequest, NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { claimFirstSystemAdmin, getSystemAdminAccess } from '@/lib/admin/access'
import {
  adminSystemServiceUpdateSchema,
  listAdminSystemServices,
  SystemServiceValidationError,
  updateAdminSystemService,
} from '@/lib/admin/system-services'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('AdminServicesAPI')

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
}

export const dynamic = 'force-dynamic'

export async function GET() {
  const requestId = generateRequestId()

  try {
    const access = await getSystemAdminAccess()
    if (!access.isAuthenticated || !access.userId) {
      logger.warn(`[${requestId}] Unauthorized admin services access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS })
    }

    if (!access.isSystemAdmin && !access.canBootstrapSystemAdmin) {
      logger.warn(`[${requestId}] Forbidden admin services access attempt`, {
        userId: access.userId,
      })
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE_HEADERS })
    }

    if (!access.isSystemAdmin && access.canBootstrapSystemAdmin) {
      const claimed = await claimFirstSystemAdmin(access.userId)
      if (!claimed) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE_HEADERS })
      }
    }

    return NextResponse.json(await listAdminSystemServices(), {
      status: 200,
      headers: NO_STORE_HEADERS,
    })
  } catch (error) {
    logger.error(`[${requestId}] Failed to load admin services`, error)
    return NextResponse.json(
      { error: 'Failed to load services' },
      { status: 500, headers: NO_STORE_HEADERS }
    )
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const access = await getSystemAdminAccess()
    if (!access.isAuthenticated || !access.userId) {
      logger.warn(`[${requestId}] Unauthorized admin services update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS })
    }

    if (!access.isSystemAdmin && !access.canBootstrapSystemAdmin) {
      logger.warn(`[${requestId}] Forbidden admin services update attempt`, {
        userId: access.userId,
      })
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE_HEADERS })
    }

    if (!access.isSystemAdmin && access.canBootstrapSystemAdmin) {
      const claimed = await claimFirstSystemAdmin(access.userId)
      if (!claimed) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE_HEADERS })
      }
    }

    const body = await request.json()
    const payload = adminSystemServiceUpdateSchema.parse(body)

    return NextResponse.json(await updateAdminSystemService(payload), {
      status: 200,
      headers: NO_STORE_HEADERS,
    })
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400, headers: NO_STORE_HEADERS }
      )
    }

    if (error instanceof SystemServiceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400, headers: NO_STORE_HEADERS })
    }

    logger.error(`[${requestId}] Failed to update admin services`, error)
    return NextResponse.json(
      { error: 'Failed to update services' },
      { status: 500, headers: NO_STORE_HEADERS }
    )
  }
}
