import { type NextRequest, NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { claimFirstSystemAdmin, getSystemAdminAccess } from '@/lib/admin/access'
import {
  adminSystemSettingsMutationSchema,
  type AdminSystemSettingsMutationInput,
} from '@/lib/admin/system-settings/mutations'
import { backfillDefaultUserSubscriptions } from '@/lib/billing/core/subscription'
import {
  getBillingGateState,
  isBillingConfigurationReady,
} from '@/lib/billing/settings'
import { createLogger } from '@/lib/logs/console/logger'
import {
  getResolvedSystemSettings,
  upsertSystemSettings,
  type ResolvedSystemSettings,
} from '@/lib/system-settings/service'
import { isTriggerConfigurationReady } from '@/lib/trigger/settings'
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

    const [snapshot, billingGate, billingReady, triggerReady] = await Promise.all([
      getResolvedSystemSettings(),
      getBillingGateState(),
      isBillingConfigurationReady(),
      isTriggerConfigurationReady(),
    ])
    return NextResponse.json(
      serializeSnapshot(snapshot, billingGate.stripeConfigured, billingReady, triggerReady),
      {
        status: 200,
        headers: NO_STORE_HEADERS,
      }
    )
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
    const [currentSettings, billingGate, billingReady, triggerReady] = await Promise.all([
      getResolvedSystemSettings(),
      getBillingGateState(),
      isBillingConfigurationReady(),
      isTriggerConfigurationReady(),
    ])
    const isEnablingBilling =
      hasPayloadField(payload, 'billingEnabled') &&
      payload.billingEnabled &&
      !currentSettings.billingEnabled

    if (isEnablingBilling && !billingGate.stripeConfigured) {
      return NextResponse.json(
        {
          error: 'Billing cannot be enabled until STRIPE_SECRET_KEY is configured.',
        },
        { status: 409, headers: NO_STORE_HEADERS }
      )
    }
    if (isEnablingBilling && !billingReady) {
      return NextResponse.json(
        {
          error:
            'Billing cannot be enabled until an active public default user tier is configured.',
        },
        { status: 409, headers: NO_STORE_HEADERS }
      )
    }

    const isEnablingTriggerDev =
      hasPayloadField(payload, 'triggerDevEnabled') &&
      payload.triggerDevEnabled &&
      !currentSettings.triggerDevEnabled

    if (isEnablingTriggerDev && !triggerReady) {
      return NextResponse.json(
        {
          error:
            'Trigger.dev cannot be enabled until TRIGGER_PROJECT_ID and TRIGGER_SECRET_KEY are configured.',
        },
        { status: 409, headers: NO_STORE_HEADERS }
      )
    }

    const snapshot = await upsertSystemSettings(payload)

    if (isEnablingBilling) {
      await backfillDefaultUserSubscriptions()
    }

    return NextResponse.json(
      serializeSnapshot(snapshot, billingGate.stripeConfigured, billingReady, triggerReady),
      {
        status: 200,
        headers: NO_STORE_HEADERS,
      }
    )
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

function hasPayloadField<Key extends keyof AdminSystemSettingsMutationInput>(
  payload: AdminSystemSettingsMutationInput,
  key: Key
): payload is AdminSystemSettingsMutationInput & Required<Pick<AdminSystemSettingsMutationInput, Key>> {
  return Object.hasOwn(payload, key)
}

function serializeSnapshot(
  snapshot: ResolvedSystemSettings,
  stripeConfigured: boolean,
  billingReady: boolean,
  triggerReady: boolean
) {
  return {
    registrationMode: snapshot.registrationMode,
    billingEnabled: stripeConfigured ? snapshot.billingEnabled : false,
    stripeConfigured,
    billingReady,
    triggerDevEnabled: snapshot.triggerDevEnabled,
    triggerReady,
    allowPromotionCodes: snapshot.allowPromotionCodes,
    emailDomain: snapshot.emailDomain,
    fromEmailAddress: snapshot.fromEmailAddress ?? '',
  }
}
