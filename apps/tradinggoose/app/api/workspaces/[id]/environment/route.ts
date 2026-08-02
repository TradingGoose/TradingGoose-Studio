import { db } from '@tradinggoose/db'
import { environmentVariables, workspace } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'
import { decryptSecret, encryptSecret } from '@/lib/utils-server'

const logger = createLogger('WorkspaceEnvironmentAPI')

const UpsertSchema = z.object({
  originalKey: z.string().min(1).nullable(),
  key: z.string().min(1),
  value: z.string().min(1),
})

const DeleteSchema = z.object({
  key: z.string().min(1),
})

function isWorkspaceKeyConflict(error: unknown) {
  const seen = new Set<unknown>()
  while (error && typeof error === 'object' && !seen.has(error)) {
    seen.add(error)
    const record = error as { code?: unknown; constraint_name?: unknown; cause?: unknown }
    if (
      record.code === '23505' &&
      record.constraint_name === 'environment_variables_workspace_key_unique'
    )
      return true
    error = record.cause
  }
  return false
}

async function decryptValue(value: string) {
  try {
    const { decrypted } = await decryptSecret(value)
    return decrypted
  } catch {
    return ''
  }
}

async function decryptRows(
  rows: Array<{ key: string; value: string; createdAt: Date; updatedAt: Date }>
) {
  const decryptedRows = await Promise.all(
    rows.map(async (row) => ({
      key: row.key,
      value: await decryptValue(row.value),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }))
  )

  const record: Record<string, string> = {}
  for (const row of decryptedRows) {
    record[row.key] = row.value
  }

  return { rows: decryptedRows, record }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const workspaceId = (await params).id

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized workspace env access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // Validate workspace exists
    const ws = await db.select().from(workspace).where(eq(workspace.id, workspaceId)).limit(1)
    if (!ws.length) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    // Require any permission to read
    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (!permission) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const [workspaceRows, personalRows] = await Promise.all([
      db
        .select({
          key: environmentVariables.key,
          value: environmentVariables.value,
          createdAt: environmentVariables.createdAt,
          updatedAt: environmentVariables.updatedAt,
        })
        .from(environmentVariables)
        .where(eq(environmentVariables.workspaceId, workspaceId)),
      db
        .select({
          key: environmentVariables.key,
          value: environmentVariables.value,
          createdAt: environmentVariables.createdAt,
          updatedAt: environmentVariables.updatedAt,
        })
        .from(environmentVariables)
        .where(eq(environmentVariables.userId, userId)),
    ])

    const [workspaceDecrypted, personalDecrypted] = await Promise.all([
      decryptRows(workspaceRows),
      decryptRows(personalRows),
    ])

    const conflicts = Object.keys(personalDecrypted.record).filter(
      (k) => k in workspaceDecrypted.record
    )

    return NextResponse.json(
      {
        data: {
          workspace: workspaceDecrypted.record,
          personal: personalDecrypted.record,
          conflicts,
          workspaceRows: workspaceDecrypted.rows,
          personalRows: personalDecrypted.rows,
        },
      },
      { status: 200 }
    )
  } catch (error: any) {
    logger.error(`[${requestId}] Workspace env GET error`, error)
    return NextResponse.json(
      { error: error.message || 'Failed to load environment' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const workspaceId = (await params).id

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized workspace env update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (!permission || (permission !== 'admin' && permission !== 'write')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { originalKey, key, value } = UpsertSchema.parse(await request.json())
    const { encrypted } = await encryptSecret(value)

    if (originalKey === null) {
      await db
        .insert(environmentVariables)
        .values({
          id: crypto.randomUUID(),
          workspaceId,
          key,
          value: encrypted,
        })
        .onConflictDoUpdate({
          target: [environmentVariables.workspaceId, environmentVariables.key],
          set: {
            value: encrypted,
            updatedAt: new Date(),
          },
        })
    } else {
      const [renamed] = await db
        .update(environmentVariables)
        .set({ key, value: encrypted, updatedAt: new Date() })
        .where(
          and(
            eq(environmentVariables.workspaceId, workspaceId),
            eq(environmentVariables.key, originalKey)
          )
        )
        .returning({ id: environmentVariables.id })
      if (!renamed) {
        return NextResponse.json({ error: 'Environment variable not found' }, { status: 404 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.issues },
        { status: 400 }
      )
    }
    if (isWorkspaceKeyConflict(error)) {
      return NextResponse.json(
        { error: 'Environment variable key already exists' },
        { status: 409 }
      )
    }
    logger.error(`[${requestId}] Workspace env PUT error`, error)
    return NextResponse.json({ error: 'Failed to update environment' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = generateRequestId()
  const workspaceId = (await params).id

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized workspace env delete attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (!permission || (permission !== 'admin' && permission !== 'write')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { key } = DeleteSchema.parse(body)

    await db
      .delete(environmentVariables)
      .where(
        and(eq(environmentVariables.workspaceId, workspaceId), eq(environmentVariables.key, key))
      )

    return NextResponse.json({ success: true })
  } catch (error: any) {
    logger.error(`[${requestId}] Workspace env DELETE error`, error)
    return NextResponse.json(
      { error: error.message || 'Failed to remove environment keys' },
      { status: 500 }
    )
  }
}
