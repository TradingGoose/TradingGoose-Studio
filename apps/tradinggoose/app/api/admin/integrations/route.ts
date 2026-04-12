import { type NextRequest, NextResponse } from 'next/server'
import { ZodError, z } from 'zod'
import { claimFirstSystemAdmin, getSystemAdminAccess } from '@/lib/admin/access'
import {
  listSystemIntegrations,
  SystemIntegrationValidationError,
  updateSystemIntegrationBundle,
} from '@/lib/admin/system-integrations'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('AdminIntegrationsAPI')

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
}

export const dynamic = 'force-dynamic'

const nullableIdSchema = z
  .union([z.string().trim().min(1), z.null()])
  .optional()
  .transform((value) => value ?? null)

const nullableBooleanSchema = z.union([z.boolean(), z.null()])

const adminIntegrationDefinitionSchema = z.object({
  id: z.string().trim().min(1),
  parentId: nullableIdSchema,
  displayName: z.string().trim().min(1),
  isEnabled: nullableBooleanSchema,
})

const adminIntegrationSecretSchema = z.object({
  id: z.string().trim().min(1),
  definitionId: z.string().trim().min(1),
  credentialKey: z.string().trim().min(1),
  value: z.string(),
  hasValue: z.boolean(),
})

const adminIntegrationsPatchSchema = z.object({
  bundleId: z.string().trim().min(1),
  definition: adminIntegrationDefinitionSchema,
  services: z.array(adminIntegrationDefinitionSchema),
  secrets: z.array(adminIntegrationSecretSchema),
})

export async function GET() {
  const requestId = generateRequestId()

  try {
    const access = await getSystemAdminAccess()
    if (!access.isAuthenticated) {
      logger.warn(`[${requestId}] Unauthorized admin integrations access attempt`)
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: NO_STORE_HEADERS }
      )
    }

    const userId = access.userId
    if (!userId) {
      logger.warn(`[${requestId}] Unauthorized admin integrations access attempt`)
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: NO_STORE_HEADERS }
      )
    }

    if (!access.isSystemAdmin && !access.canBootstrapSystemAdmin) {
      logger.warn(`[${requestId}] Forbidden admin integrations access attempt`, {
        userId,
      })
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE_HEADERS })
    }

    if (!access.isSystemAdmin && access.canBootstrapSystemAdmin) {
      const claimed = await claimFirstSystemAdmin(userId)
      if (!claimed) {
        logger.warn(`[${requestId}] Bootstrap admin claim lost`, {
          userId,
        })
        return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE_HEADERS })
      }
    }

    const data = await listSystemIntegrations()
    return NextResponse.json(serializeSnapshot(data), {
      status: 200,
      headers: NO_STORE_HEADERS,
    })
  } catch (error) {
    logger.error(`[${requestId}] Failed to load admin integrations`, error)
    return NextResponse.json(
      { error: 'Failed to load integrations' },
      { status: 500, headers: NO_STORE_HEADERS }
    )
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const access = await getSystemAdminAccess()
    if (!access.isAuthenticated) {
      logger.warn(`[${requestId}] Unauthorized admin integrations update attempt`)
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: NO_STORE_HEADERS }
      )
    }

    const userId = access.userId
    if (!userId) {
      logger.warn(`[${requestId}] Unauthorized admin integrations update attempt`)
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: NO_STORE_HEADERS }
      )
    }

    if (!access.isSystemAdmin && !access.canBootstrapSystemAdmin) {
      logger.warn(`[${requestId}] Forbidden admin integrations update attempt`, {
        userId,
      })
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE_HEADERS })
    }

    const body = await request.json()
    const payload = adminIntegrationsPatchSchema.parse(body)

    if (payload.bundleId !== payload.definition.id) {
      return NextResponse.json(
        { error: 'Bundle payload does not match definition id' },
        { status: 400, headers: NO_STORE_HEADERS }
      )
    }

    if (!access.isSystemAdmin && access.canBootstrapSystemAdmin) {
      const claimed = await claimFirstSystemAdmin(userId)
      if (!claimed) {
        logger.warn(`[${requestId}] Bootstrap admin claim lost`, {
          userId,
        })
        return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE_HEADERS })
      }
    }

    await updateSystemIntegrationBundle({
      definition: {
        id: payload.definition.id,
        parentId: payload.definition.parentId,
        name: payload.definition.displayName,
        isEnabled: payload.definition.isEnabled,
      },
      services: payload.services.map((service) => ({
        id: service.id,
        parentId: service.parentId,
        name: service.displayName,
        isEnabled: service.isEnabled,
      })),
      secrets: payload.secrets.map((secret) => ({
        id: secret.id,
        definitionId: secret.definitionId,
        key: secret.credentialKey,
        value: secret.value,
        hasValue: secret.hasValue,
      })),
    })

    const data = await listSystemIntegrations()
    return NextResponse.json(serializeSnapshot(data), {
      status: 200,
      headers: NO_STORE_HEADERS,
    })
  } catch (error) {
    if (error instanceof ZodError) {
      logger.warn(`[${requestId}] Invalid admin integrations payload`, {
        errors: error.errors,
      })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400, headers: NO_STORE_HEADERS }
      )
    }

    if (error instanceof SystemIntegrationValidationError) {
      logger.warn(`[${requestId}] Rejected admin integrations payload`, {
        message: error.message,
      })
      return NextResponse.json({ error: error.message }, { status: 400, headers: NO_STORE_HEADERS })
    }

    logger.error(`[${requestId}] Failed to update admin integrations`, error)
    return NextResponse.json(
      { error: 'Failed to update integrations' },
      { status: 500, headers: NO_STORE_HEADERS }
    )
  }
}

function serializeSnapshot(data: Awaited<ReturnType<typeof listSystemIntegrations>>) {
  return {
    definitions: data.definitions.map((definition) => ({
      id: definition.id,
      parentId: definition.parentId,
      displayName: definition.name,
      isEnabled: definition.isEnabled,
    })),
    secrets: data.secrets.map((secret) => ({
      id: secret.id,
      definitionId: secret.definitionId,
      credentialKey: secret.key,
      hasValue: secret.hasValue,
    })),
  }
}
