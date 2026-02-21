import { db } from '@tradinggoose/db'
import { environmentVariables, workspace } from '@tradinggoose/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { decryptSecret, encryptSecret, generateRequestId } from '@/lib/utils'

const logger = createLogger('WorkspaceEnvironmentAPI')

const UpsertSchema = z.object({
  variables: z.record(z.string()),
})

const DeleteSchema = z.object({
  keys: z.array(z.string()).min(1),
})

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

    const body = await request.json()
    const { variables } = UpsertSchema.parse(body)

    await db.transaction(async (tx) => {
      for (const [key, value] of Object.entries(variables)) {
        const { encrypted } = await encryptSecret(value)

        await tx
          .insert(environmentVariables)
          .values({
            id: crypto.randomUUID(),
            workspaceId,
            key,
            value: encrypted,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [environmentVariables.workspaceId, environmentVariables.key],
            set: {
              value: encrypted,
              updatedAt: new Date(),
            },
          })
      }
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    logger.error(`[${requestId}] Workspace env PUT error`, error)
    return NextResponse.json(
      { error: error.message || 'Failed to update environment' },
      { status: 500 }
    )
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
    const { keys } = DeleteSchema.parse(body)

    await db
      .delete(environmentVariables)
      .where(
        and(
          eq(environmentVariables.workspaceId, workspaceId),
          inArray(environmentVariables.key, keys)
        )
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
