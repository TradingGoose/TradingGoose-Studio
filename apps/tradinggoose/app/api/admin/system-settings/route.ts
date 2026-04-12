import { type NextRequest, NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { claimFirstSystemAdmin, getSystemAdminAccess } from '@/lib/admin/access'
import { adminSystemSettingsMutationSchema } from '@/lib/admin/system-settings/mutations'
import { backfillDefaultUserSubscriptions } from '@/lib/billing/core/subscription'
import { isBillingConfigurationReady } from '@/lib/billing/settings'
import { createLogger } from '@/lib/logs/console/logger'
import { getResolvedSystemSettings, upsertSystemSettings } from '@/lib/system-settings/service'
import { setCachedStripeSettings } from '@/lib/system-settings/stripe-runtime'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('AdminSystemSettingsAPI')

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
}

export const dynamic = 'force-dynamic'

export async function GET() {
  const requestId = generateRequestId()

  try {
    const access = await getSystemAdminAccess()
    if (!access.isAuthenticated) {
      logger.warn(`[${requestId}] Unauthorized admin system settings access attempt`)
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
      logger.warn(`[${requestId}] Forbidden admin system settings access attempt`, { userId })
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE_HEADERS })
    }

    if (!access.isSystemAdmin && access.canBootstrapSystemAdmin) {
      const claimed = await claimFirstSystemAdmin(userId)
      if (!claimed) {
        logger.warn(`[${requestId}] Bootstrap admin claim lost`, { userId })
        return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE_HEADERS })
      }
    }

    const [snapshot, billingReady] = await Promise.all([
      getResolvedSystemSettings(),
      isBillingConfigurationReady(),
    ])
    return NextResponse.json(serializeSnapshot(snapshot, billingReady), {
      status: 200,
      headers: NO_STORE_HEADERS,
    })
  } catch (error) {
    logger.error(`[${requestId}] Failed to load admin system settings`, error)
    return NextResponse.json(
      { error: 'Failed to load system settings' },
      { status: 500, headers: NO_STORE_HEADERS }
    )
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const access = await getSystemAdminAccess()
    if (!access.isAuthenticated) {
      logger.warn(`[${requestId}] Unauthorized admin system settings update attempt`)
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
      logger.warn(`[${requestId}] Forbidden admin system settings update attempt`, { userId })
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
    const payload = adminSystemSettingsMutationSchema.parse(body)
    const [currentSettings, billingReady] = await Promise.all([
      getResolvedSystemSettings(),
      isBillingConfigurationReady(),
    ])
    const isEnablingBilling = payload.billingEnabled === true && !currentSettings.billingEnabled
    if (payload.billingEnabled && !billingReady) {
      return NextResponse.json(
        {
          error:
            'Billing cannot be enabled until an active public default user tier is configured.',
        },
        { status: 409, headers: NO_STORE_HEADERS }
      )
    }

    if (isEnablingBilling) {
      await backfillDefaultUserSubscriptions()
    }

    const snapshot = await upsertSystemSettings(payload)

    if (isEnablingBilling) {
      await backfillDefaultUserSubscriptions()
    }

    setCachedStripeSettings({
      stripeSecretKey: snapshot.stripeSecretKey,
      stripeWebhookSecret: snapshot.stripeWebhookSecret,
    })

    return NextResponse.json(serializeSnapshot(snapshot, billingReady), {
      status: 200,
      headers: NO_STORE_HEADERS,
    })
  } catch (error) {
    if (error instanceof ZodError) {
      logger.warn(`[${requestId}] Invalid admin system settings payload`, {
        errors: error.errors,
      })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400, headers: NO_STORE_HEADERS }
      )
    }

    logger.error(`[${requestId}] Failed to update admin system settings`, error)
    return NextResponse.json(
      { error: 'Failed to update system settings' },
      { status: 500, headers: NO_STORE_HEADERS }
    )
  }
}

function serializeSnapshot(
  snapshot: Awaited<ReturnType<typeof getResolvedSystemSettings>>,
  billingReady: boolean
) {
  return {
    registrationMode: snapshot.registrationMode,
    billingEnabled: snapshot.billingEnabled,
    billingReady,
    allowPromotionCodes: snapshot.allowPromotionCodes,
    stripeSecretKey: snapshot.stripeSecretKey ?? '',
    stripeWebhookSecret: snapshot.stripeWebhookSecret ?? '',
  }
}
