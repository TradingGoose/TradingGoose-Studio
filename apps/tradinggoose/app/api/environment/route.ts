import { db } from '@tradinggoose/db'
import { environmentVariables } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { decryptSecret, encryptSecret } from '@/lib/utils-server'
import type { EnvironmentVariable } from '@/stores/settings/environment/types'

const logger = createLogger('EnvironmentAPI')

const EnvVarSchema = z.object({
  variables: z.record(z.string()),
})
const UpsertEnvVarSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
})
const DeleteEnvVarSchema = z.object({
  key: z.string().min(1),
})

export async function POST(req: NextRequest) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized environment variables update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()

    try {
      const { variables } = EnvVarSchema.parse(body)

      const userId = session.user.id
      const encryptedRows = await Promise.all(
        Object.entries(variables).map(async ([key, value]) => {
          const { encrypted } = await encryptSecret(value)
          return {
            id: crypto.randomUUID(),
            userId,
            key,
            value: encrypted,
          }
        })
      )

      await db.transaction(async (tx) => {
        await tx.delete(environmentVariables).where(eq(environmentVariables.userId, userId))

        if (encryptedRows.length > 0) {
          await tx.insert(environmentVariables).values(encryptedRows)
        }
      })

      return NextResponse.json({ success: true })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid environment variables data`, {
          errors: validationError.errors,
        })
        return NextResponse.json(
          { error: 'Invalid request data', details: validationError.errors },
          { status: 400 }
        )
      }
      throw validationError
    }
  } catch (error) {
    logger.error(`[${requestId}] Error updating environment variables`, error)
    return NextResponse.json({ error: 'Failed to update environment variables' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized environment variable update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { key, value } = UpsertEnvVarSchema.parse(body)
    const { encrypted } = await encryptSecret(value)

    await db
      .insert(environmentVariables)
      .values({
        id: crypto.randomUUID(),
        userId: session.user.id,
        key,
        value: encrypted,
      })
      .onConflictDoUpdate({
        target: [environmentVariables.userId, environmentVariables.key],
        set: {
          value: encrypted,
          updatedAt: new Date(),
        },
      })

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid personal environment variable payload`, {
        errors: error.errors,
      })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error upserting environment variable`, error)
    return NextResponse.json({ error: 'Failed to update environment variable' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized environment variable delete attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { key } = DeleteEnvVarSchema.parse(body)

    await db
      .delete(environmentVariables)
      .where(
        and(eq(environmentVariables.userId, session.user.id), eq(environmentVariables.key, key))
      )

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid personal environment variable delete payload`, {
        errors: error.errors,
      })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error deleting environment variable`, error)
    return NextResponse.json({ error: 'Failed to delete environment variable' }, { status: 500 })
  }
}

export async function GET(request: Request) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized environment variables access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const rows = await db
      .select({
        key: environmentVariables.key,
        value: environmentVariables.value,
      })
      .from(environmentVariables)
      .where(eq(environmentVariables.userId, userId))

    if (!rows.length) {
      return NextResponse.json({ data: {} }, { status: 200 })
    }

    const decryptedVariables: Record<string, EnvironmentVariable> = {}

    for (const row of rows) {
      try {
        const { decrypted } = await decryptSecret(row.value)
        decryptedVariables[row.key] = { key: row.key, value: decrypted }
      } catch (error) {
        logger.error(`[${requestId}] Error decrypting variable ${row.key}`, error)
        decryptedVariables[row.key] = { key: row.key, value: '' }
      }
    }

    return NextResponse.json({ data: decryptedVariables }, { status: 200 })
  } catch (error: any) {
    logger.error(`[${requestId}] Environment fetch error`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
