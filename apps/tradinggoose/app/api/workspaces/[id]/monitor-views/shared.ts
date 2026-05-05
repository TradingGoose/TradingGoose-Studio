import { db } from '@tradinggoose/db'
import { monitorView } from '@tradinggoose/db/schema'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import {
  assertStoredMonitorSavedViewConfig,
  InvalidMonitorViewConfigRequestError,
  type MonitorPageMode,
  type MonitorViewRow,
  UnsupportedMonitorViewConfigError,
} from '@/app/workspace/[workspaceId]/monitor/components/view/view-config'

export const unsupportedMonitorViewDataMessage =
  'Unsupported monitor view data. Delete or reset stale mode-less monitor_view rows for this workspace before using the mode-aware monitor page.'

export const invalidMonitorViewConfigMessage = 'Invalid monitor view config.'

export const monitorViewErrorResponse = (error: unknown) => {
  if (error instanceof UnsupportedMonitorViewConfigError) {
    return NextResponse.json({ error: unsupportedMonitorViewDataMessage }, { status: 409 })
  }

  if (error instanceof InvalidMonitorViewConfigRequestError) {
    return NextResponse.json({ error: invalidMonitorViewConfigMessage }, { status: 400 })
  }

  return null
}

export const toStrictMonitorViewRow = (row: typeof monitorView.$inferSelect): MonitorViewRow => {
  const config = assertStoredMonitorSavedViewConfig(row.config)

  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order ?? 0,
    isActive: !!row.isActive,
    mode: config.mode,
    config,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export const tryStrictMonitorViewRow = (row: typeof monitorView.$inferSelect) => {
  try {
    return toStrictMonitorViewRow(row)
  } catch (error) {
    if (error instanceof UnsupportedMonitorViewConfigError) {
      return null
    }
    throw error
  }
}

export const listMonitorViewRows = async (workspaceId: string, userId: string) =>
  db
    .select()
    .from(monitorView)
    .where(and(eq(monitorView.workspaceId, workspaceId), eq(monitorView.userId, userId)))
    .orderBy(asc(monitorView.sort_order), asc(monitorView.createdAt))

export const listStrictMonitorViewRows = async (workspaceId: string, userId: string) => {
  const rows = await listMonitorViewRows(workspaceId, userId)
  return rows.map(toStrictMonitorViewRow)
}

export const clearActiveForMode = async (
  tx: Pick<typeof db, 'update'>,
  rows: MonitorViewRow[],
  mode: MonitorPageMode
) => {
  const ids = rows.filter((row) => row.mode === mode).map((row) => row.id)
  if (ids.length === 0) return

  await tx
    .update(monitorView)
    .set({ isActive: false, updatedAt: new Date() })
    .where(inArray(monitorView.id, ids))
}

export const groupRowsByMode = (rows: MonitorViewRow[]) =>
  rows.reduce<Record<MonitorPageMode, MonitorViewRow[]>>(
    (groups, row) => {
      if (row.mode) {
        groups[row.mode].push(row)
      }
      return groups
    },
    { executions: [], config: [] }
  )

export const findStrictRowById = (rows: MonitorViewRow[], viewId: string) =>
  rows.find((row) => row.id === viewId) ?? null

export const getRowsForMode = (rows: MonitorViewRow[], mode: MonitorPageMode) =>
  rows.filter((row) => row.mode === mode)

export const isMonitorPageMode = (value: unknown): value is MonitorPageMode =>
  value === 'executions' || value === 'config'

export const sortRowsForPersistence = (rows: MonitorViewRow[]) =>
  [...rows].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder
    return left.createdAt.localeCompare(right.createdAt)
  })

export const compactRowsForPersistence = (rows: MonitorViewRow[]) =>
  sortRowsForPersistence(rows).map((row, sortOrder) => ({ ...row, sortOrder }))

export const rebuildRowsWithSameModeOrder = (
  rows: MonitorViewRow[],
  mode: MonitorPageMode,
  viewOrder: string[]
) => {
  const sameModeRowsById = new Map(
    sortRowsForPersistence(rows)
      .filter((row) => row.mode === mode)
      .map((row) => [row.id, row])
  )
  const reorderedSameModeRows = viewOrder.map((id) => sameModeRowsById.get(id)!)
  let sameModeIndex = 0

  return sortRowsForPersistence(rows)
    .map((row) => (row.mode === mode ? (reorderedSameModeRows[sameModeIndex++] ?? row) : row))
    .map((row, sortOrder) => ({ ...row, sortOrder }))
}
