import { db } from '@tradinggoose/db'
import { monitorView } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { checkWorkspacePermission } from '@/app/api/indicators/utils'
import {
  InvalidMonitorViewConfigRequestError,
  type MonitorViewRow,
  parseMonitorSavedViewConfig,
  UnsupportedMonitorViewConfigError,
  type UpdateMonitorViewBody,
} from '@/app/workspace/[workspaceId]/monitor/components/view/view-config'
import {
  clearActiveForMode,
  compactRowsForPersistence,
  findStrictRowById,
  getRowsForMode,
  listMonitorViewRows,
  listStrictMonitorViewRows,
  monitorViewErrorResponse,
  tryStrictMonitorViewRow,
} from '../shared'

const getUserId = async () => {
  const session = await getSession()
  return session?.user?.id ?? null
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; viewId: string }> }
) {
  const userId = await getUserId()

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: workspaceId, viewId } = await params

  const permission = await checkWorkspacePermission({
    userId,
    workspaceId,
    requireWrite: true,
    responseShape: 'errorOnly',
  })
  if (!permission.ok) return permission.response

  const body = (await request.json().catch(() => null)) as UpdateMonitorViewBody | null
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  if (typeof body.name === 'undefined' && typeof body.config === 'undefined') {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
  }

  try {
    const rows = await listStrictMonitorViewRows(workspaceId, userId)
    const existing = findStrictRowById(rows, viewId)

    if (!existing) {
      return NextResponse.json({ error: 'View not found' }, { status: 404 })
    }

    const nextName = typeof body.name === 'string' ? body.name.trim() : undefined
    if (typeof body.name !== 'undefined' && !nextName) {
      return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
    }

    let nextConfig = existing.config
    if (typeof body.config !== 'undefined') {
      try {
        nextConfig = parseMonitorSavedViewConfig(body.config)
      } catch (error) {
        if (error instanceof InvalidMonitorViewConfigRequestError) {
          return NextResponse.json({ error: 'Invalid monitor view config.' }, { status: 400 })
        }
        throw error
      }

      if (nextConfig.mode !== existing.mode) {
        return NextResponse.json({ error: 'Cannot change view mode' }, { status: 400 })
      }
    }

    await db
      .update(monitorView)
      .set({
        ...(nextName ? { name: nextName } : {}),
        ...(typeof body.config !== 'undefined' ? { config: nextConfig } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(monitorView.id, viewId),
          eq(monitorView.workspaceId, workspaceId),
          eq(monitorView.userId, userId)
        )
      )

    const refreshedRows = await listStrictMonitorViewRows(workspaceId, userId)
    const updatedRow = findStrictRowById(refreshedRows, viewId)

    if (!updatedRow) {
      return NextResponse.json({ error: 'View not found' }, { status: 404 })
    }

    return NextResponse.json(updatedRow)
  } catch (error) {
    const response = monitorViewErrorResponse(error)
    if (response) return response
    throw error
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; viewId: string }> }
) {
  const userId = await getUserId()

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: workspaceId, viewId } = await params

  const permission = await checkWorkspacePermission({
    userId,
    workspaceId,
    requireWrite: true,
    responseShape: 'errorOnly',
  })
  if (!permission.ok) return permission.response

  try {
    const rawRows = await listMonitorViewRows(workspaceId, userId)
    const rawRow = rawRows.find((row) => row.id === viewId)

    if (!rawRow) {
      return NextResponse.json({ error: 'View not found' }, { status: 404 })
    }

    const strictRows = rawRows.map(tryStrictMonitorViewRow)
    const row = strictRows.find((entry) => entry?.id === viewId) ?? null

    if (!row) {
      await db.transaction(async (tx) => {
        await tx
          .delete(monitorView)
          .where(
            and(
              eq(monitorView.id, viewId),
              eq(monitorView.workspaceId, workspaceId),
              eq(monitorView.userId, userId)
            )
          )
      })

      return NextResponse.json({ success: true })
    }

    if (strictRows.some((entry) => !entry)) {
      const response = monitorViewErrorResponse(new UnsupportedMonitorViewConfigError())
      if (response) return response
    }

    const rows = strictRows.filter((entry): entry is MonitorViewRow => Boolean(entry))
    const rowMode = row.mode ?? row.config.mode
    const sameModeRows = getRowsForMode(rows, rowMode)
    if (sameModeRows.length === 1) {
      return NextResponse.json(
        { error: 'Cannot delete the last remaining view for this mode' },
        { status: 400 }
      )
    }

    const sameModeIndex = sameModeRows.findIndex((entry) => entry.id === viewId)
    const previousSameModeRow = sameModeIndex > 0 ? sameModeRows[sameModeIndex - 1] : null
    const nextSameModeRow =
      sameModeIndex < sameModeRows.length - 1 ? sameModeRows[sameModeIndex + 1] : null
    const nextActiveId = row.isActive
      ? (previousSameModeRow?.id ?? nextSameModeRow?.id ?? null)
      : null
    const remainingRows = compactRowsForPersistence(rows.filter((entry) => entry.id !== viewId))

    await db.transaction(async (tx) => {
      await tx
        .delete(monitorView)
        .where(
          and(
            eq(monitorView.id, viewId),
            eq(monitorView.workspaceId, workspaceId),
            eq(monitorView.userId, userId)
          )
        )

      for (const remainingRow of remainingRows) {
        await tx
          .update(monitorView)
          .set({ sort_order: remainingRow.sortOrder, updatedAt: new Date() })
          .where(
            and(
              eq(monitorView.id, remainingRow.id),
              eq(monitorView.workspaceId, workspaceId),
              eq(monitorView.userId, userId)
            )
          )
      }

      if (nextActiveId) {
        await clearActiveForMode(tx, remainingRows, rowMode)

        await tx
          .update(monitorView)
          .set({ isActive: true, updatedAt: new Date() })
          .where(
            and(
              eq(monitorView.id, nextActiveId),
              eq(monitorView.workspaceId, workspaceId),
              eq(monitorView.userId, userId)
            )
          )
      }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    const response = monitorViewErrorResponse(error)
    if (response) return response
    throw error
  }
}
