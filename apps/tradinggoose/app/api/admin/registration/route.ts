import { NextRequest, NextResponse } from 'next/server'
import { ZodError, z } from 'zod'
import { claimFirstSystemAdmin, getSystemAdminAccess } from '@/lib/admin/access'
import { createLogger } from '@/lib/logs/console/logger'
import {
  getRegistrationMode,
  listWaitlistEntries,
  setRegistrationMode,
  updateWaitlistStatuses,
} from '@/lib/registration/service'
import { REGISTRATION_MODE_VALUES } from '@/lib/registration/shared'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('AdminRegistrationAPI')

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
}

const registrationModeSchema = z.enum(REGISTRATION_MODE_VALUES)
const registrationPatchSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('settings'),
    registrationMode: registrationModeSchema,
  }),
  z.object({
    type: z.literal('waitlist'),
    ids: z.array(z.string().trim().min(1)).min(1),
    status: z.enum(['approved', 'rejected']),
  }),
])

export const dynamic = 'force-dynamic'

export async function GET() {
  const requestId = generateRequestId()

  try {
    const access = await getSystemAdminAccess()
    if (!access.isAuthenticated) {
      logger.warn(`[${requestId}] Unauthorized admin registration access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS })
    }

    const userId = access.userId
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS })
    }

    if (!access.isSystemAdmin && !access.canBootstrapSystemAdmin) {
      logger.warn(`[${requestId}] Forbidden admin registration access attempt`, { userId })
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE_HEADERS })
    }

    return NextResponse.json(await serializeSnapshot(), { status: 200, headers: NO_STORE_HEADERS })
  } catch (error) {
    logger.error(`[${requestId}] Failed to load admin registration`, error)
    return NextResponse.json(
      { error: 'Failed to load registration settings' },
      { status: 500, headers: NO_STORE_HEADERS }
    )
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const access = await getSystemAdminAccess()
    if (!access.isAuthenticated) {
      logger.warn(`[${requestId}] Unauthorized admin registration update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS })
    }

    const userId = access.userId
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS })
    }

    if (!access.isSystemAdmin && !access.canBootstrapSystemAdmin) {
      logger.warn(`[${requestId}] Forbidden admin registration update attempt`, { userId })
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE_HEADERS })
    }

    if (!access.isSystemAdmin && access.canBootstrapSystemAdmin) {
      const claimed = await claimFirstSystemAdmin(userId)
      if (!claimed) {
        logger.warn(`[${requestId}] Bootstrap admin claim lost`, { userId })
        return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE_HEADERS })
      }
    }

    const body = await request.json()
    const payload = registrationPatchSchema.parse(body)

    if (payload.type === 'settings') {
      await setRegistrationMode(payload.registrationMode)
    } else {
      await updateWaitlistStatuses({
        ids: payload.ids,
        status: payload.status,
        reviewerUserId: userId,
      })
    }

    return NextResponse.json(await serializeSnapshot(), { status: 200, headers: NO_STORE_HEADERS })
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400, headers: NO_STORE_HEADERS }
      )
    }

    logger.error(`[${requestId}] Failed to update admin registration`, error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update registration settings' },
      { status: 400, headers: NO_STORE_HEADERS }
    )
  }
}

async function serializeSnapshot() {
  const [registrationMode, waitlist] = await Promise.all([
    getRegistrationMode(),
    listWaitlistEntries(),
  ])

  return {
    registrationMode,
    waitlist: waitlist.map((entry) => ({
      id: entry.id,
      email: entry.email,
      status: entry.status,
      approvedAt: entry.approvedAt?.toISOString() ?? null,
      approvedByUserId: entry.approvedByUserId,
      rejectedAt: entry.rejectedAt?.toISOString() ?? null,
      rejectedByUserId: entry.rejectedByUserId,
      signedUpAt: entry.signedUpAt?.toISOString() ?? null,
      userId: entry.userId,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    })),
  }
}
