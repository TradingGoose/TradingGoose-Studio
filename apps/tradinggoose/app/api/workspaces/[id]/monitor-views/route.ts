import { randomUUID } from 'crypto'
import { db } from '@tradinggoose/db'
import { monitorView } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { checkWorkspacePermission } from '@/app/api/indicators/utils'
import {
  type CreateMonitorViewBody,
  InvalidMonitorViewConfigRequestError,
  type MonitorPageMode,
  type MonitorSavedViewConfig,
  type MonitorViewRow,
  parseMonitorSavedViewConfig,
} from '@/app/workspace/[workspaceId]/monitor/components/view/view-config'
import {
  clearActiveForMode,
  findStrictRowById,
  getRowsForMode,
  isMonitorPageMode,
  listStrictMonitorViewRows,
  monitorViewErrorResponse,
  rebuildRowsWithSameModeOrder,
  toStrictMonitorViewRow,
} from './shared'

const getUserId = async () => {
  const session = await getSession()
  return session?.user?.id ?? null
}

const sameStringSet = (left: string[], right: string[]) => {
  if (left.length !== right.length) return false
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  if (leftSet.size !== left.length || rightSet.size !== right.length) return false
  return left.every((entry) => rightSet.has(entry))
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId()

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: workspaceId } = await params

  try {
    const permission = await checkWorkspacePermission({
      userId,
      workspaceId,
      responseShape: 'errorOnly',
    })
    if (!permission.ok) return permission.response

    const rows = await listStrictMonitorViewRows(workspaceId, userId)
    return NextResponse.json({ data: rows })
  } catch (error) {
    const response = monitorViewErrorResponse(error)
    if (response) return response
    throw error
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId()

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: workspaceId } = await params

  const permission = await checkWorkspacePermission({
    userId,
    workspaceId,
    requireWrite: true,
    responseShape: 'errorOnly',
  })
  if (!permission.ok) return permission.response

  const body = (await request.json().catch(() => null)) as CreateMonitorViewBody | null
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const trimmedName = typeof body.name === 'string' ? body.name.trim() : ''
  if (!trimmedName) {
    return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
  }

  let normalizedConfig: MonitorSavedViewConfig
  try {
    normalizedConfig = parseMonitorSavedViewConfig(body.config)
  } catch (error) {
    if (error instanceof InvalidMonitorViewConfigRequestError) {
      return NextResponse.json({ error: 'Invalid monitor view config.' }, { status: 400 })
    }
    throw error
  }

  try {
    const existingRows = await listStrictMonitorViewRows(workspaceId, userId)
    const sameModeRows = getRowsForMode(existingRows, normalizedConfig.mode)
    const highestSortOrder = existingRows.reduce(
      (max, row) => Math.max(max, row.sortOrder ?? -1),
      -1
    )
    const shouldMakeActive =
      typeof body.makeActive === 'boolean' ? body.makeActive : sameModeRows.length === 0

    const inserted = await db.transaction(async (tx) => {
      if (shouldMakeActive) {
        await clearActiveForMode(tx, existingRows, normalizedConfig.mode)
      }

      const [created] = await tx
        .insert(monitorView)
        .values({
          id: randomUUID(),
          workspaceId,
          userId,
          name: trimmedName,
          sort_order: highestSortOrder + 1,
          config: normalizedConfig,
          isActive: shouldMakeActive,
        })
        .returning()

      if (!created) {
        throw new Error('Failed to create monitor view')
      }

      return created
    })

    return NextResponse.json(toStrictMonitorViewRow(inserted), { status: 201 })
  } catch (error) {
    const response = monitorViewErrorResponse(error)
    if (response) return response
    throw error
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId()

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: workspaceId } = await params

  const permission = await checkWorkspacePermission({
    userId,
    workspaceId,
    requireWrite: true,
    responseShape: 'errorOnly',
  })
  if (!permission.ok) return permission.response

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const rawViewOrder = Object.hasOwn(body, 'viewOrder') ? (body as any).viewOrder : undefined
  if (typeof rawViewOrder !== 'undefined' && !Array.isArray(rawViewOrder)) {
    return NextResponse.json({ error: 'Invalid viewOrder' }, { status: 400 })
  }

  const hasViewOrder = Array.isArray(rawViewOrder)
  const viewOrder = hasViewOrder ? rawViewOrder.map((entry) => String(entry).trim()) : null
  if (viewOrder?.some((entry) => !entry)) {
    return NextResponse.json({ error: 'Invalid viewOrder' }, { status: 400 })
  }

  const mode = isMonitorPageMode((body as any).mode)
    ? ((body as any).mode as MonitorPageMode)
    : null
  if (hasViewOrder && !mode) {
    return NextResponse.json({ error: 'Mode is required when reordering views' }, { status: 400 })
  }

  const activeViewId =
    typeof (body as any).activeViewId === 'string' && (body as any).activeViewId.trim()
      ? (body as any).activeViewId.trim()
      : null

  if (!viewOrder && !activeViewId) {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
  }

  try {
    const rows = await listStrictMonitorViewRows(workspaceId, userId)
    const activeRow = activeViewId ? findStrictRowById(rows, activeViewId) : null
    if (activeViewId && !activeRow) {
      return NextResponse.json({ error: 'Invalid activeViewId' }, { status: 400 })
    }

    if (mode && activeRow && activeRow.mode !== mode) {
      return NextResponse.json(
        { error: 'Active view must belong to the reordered mode' },
        { status: 400 }
      )
    }

    const activeMode = activeRow?.mode ?? mode
    if (!activeMode) {
      return NextResponse.json({ error: 'Invalid activeViewId' }, { status: 400 })
    }

    let reorderedRows: MonitorViewRow[] | null = null

    if (viewOrder && mode) {
      const sameModeRows = rows.filter((row) => row.mode === mode)
      const sameModeIds = sameModeRows.map((row) => row.id)
      if (!sameStringSet(viewOrder, sameModeIds)) {
        return NextResponse.json({ error: 'Invalid viewOrder' }, { status: 400 })
      }

      reorderedRows = rebuildRowsWithSameModeOrder(rows, mode, viewOrder)
    }

    await db.transaction(async (tx) => {
      if (reorderedRows) {
        for (const row of reorderedRows) {
          await tx
            .update(monitorView)
            .set({ sort_order: row.sortOrder, updatedAt: new Date() })
            .where(
              and(
                eq(monitorView.id, row.id),
                eq(monitorView.workspaceId, workspaceId),
                eq(monitorView.userId, userId)
              )
            )
        }
      }

      if (activeViewId) {
        await clearActiveForMode(tx, rows, activeMode)

        await tx
          .update(monitorView)
          .set({ isActive: true, updatedAt: new Date() })
          .where(
            and(
              eq(monitorView.id, activeViewId),
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
