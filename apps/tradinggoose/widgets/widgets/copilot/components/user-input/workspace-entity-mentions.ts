import { buildEntityListDescriptor } from '@/lib/copilot/review-sessions/identity'
import { getEntityListMembers } from '@/lib/yjs/entity-session'
import { bootstrapYjsProvider } from '@/lib/yjs/provider'
import type { CopilotWorkspaceEntityKind } from '../../workspace-entities'
import type { WorkspaceEntityItem } from './types'

const sortByRecent = <T extends { createdAt?: string; updatedAt?: string }>(items: T[]) =>
  [...items].sort((left, right) => {
    const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime()
    const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime()
    return rightTime - leftTime
  })

const toTrimmedString = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const readDashboardLayoutSortOrder = (item: WorkspaceEntityItem) =>
  typeof item.sortOrder === 'number' && Number.isFinite(item.sortOrder)
    ? item.sortOrder
    : Number.MAX_SAFE_INTEGER

const readDashboardLayoutCreatedAt = (item: WorkspaceEntityItem) => {
  const createdAt = toTrimmedString(item.createdAt)
  if (!createdAt) return Number.MAX_SAFE_INTEGER
  const time = new Date(createdAt).getTime()
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER
}

const sortDashboardLayoutMentionItems = (items: WorkspaceEntityItem[]) =>
  [...items].sort((left, right) => {
    const orderDelta = readDashboardLayoutSortOrder(left) - readDashboardLayoutSortOrder(right)
    if (orderDelta !== 0) return orderDelta

    const createdDelta = readDashboardLayoutCreatedAt(left) - readDashboardLayoutCreatedAt(right)
    if (createdDelta !== 0) return createdDelta

    return left.id.localeCompare(right.id)
  })

export async function loadWorkspaceEntityMentionItems(
  entityKind: CopilotWorkspaceEntityKind,
  workspaceId: string,
  ownerUserId?: string | null
): Promise<WorkspaceEntityItem[]> {
  if (entityKind === 'dashboard_layout' || entityKind === 'watchlist') {
    return loadYjsEntityMentionItems(entityKind, workspaceId, ownerUserId)
  }

  let path = ''

  switch (entityKind) {
    case 'workflow':
      path = `/api/workflows?workspaceId=${encodeURIComponent(workspaceId)}`
      break
    case 'skill':
      path = `/api/skills?workspaceId=${encodeURIComponent(workspaceId)}`
      break
    case 'indicator':
      path = `/api/indicators/custom?workspaceId=${encodeURIComponent(workspaceId)}`
      break
    case 'custom_tool':
      path = `/api/tools/custom?workspaceId=${encodeURIComponent(workspaceId)}`
      break
    case 'mcp_server':
      path = `/api/mcp/servers?workspaceId=${encodeURIComponent(workspaceId)}`
      break
  }

  const response = await fetch(path)
  if (!response.ok) {
    throw new Error(`Failed to load ${entityKind}: ${response.status}`)
  }
  const data = await response.json()

  switch (entityKind) {
    case 'workflow':
      return sortByRecent(Array.isArray(data?.data) ? data.data : [])
        .filter((item: any) => item.id)
        .map((item: any) => ({
          entityKind,
          id: item.id,
          name: toTrimmedString(item.name),
          color: item.color,
        }))
    case 'skill':
      return sortByRecent(Array.isArray(data?.data) ? data.data : [])
        .filter((item: any) => item.id)
        .map((item: any) => ({
          entityKind,
          id: item.id,
          name: toTrimmedString(item.name),
          description: toTrimmedString(item.description),
        }))
    case 'indicator':
      return sortByRecent(Array.isArray(data?.data) ? data.data : [])
        .filter((item: any) => item.id)
        .map((item: any) => ({
          entityKind,
          id: item.id,
          name: toTrimmedString(item.name),
          color: item.color,
        }))
    case 'custom_tool':
      return sortByRecent(Array.isArray(data?.data) ? data.data : [])
        .filter((item: any) => item.id)
        .map((item: any) => ({
          entityKind,
          id: item.id,
          name: toTrimmedString(item.title),
          description: toTrimmedString(item.schema?.function?.description),
        }))
    case 'mcp_server':
      return (Array.isArray(data?.data?.servers) ? data.data.servers : [])
        .filter((item: any) => item.id)
        .sort((left: any, right: any) =>
          toTrimmedString(left.name).localeCompare(toTrimmedString(right.name))
        )
        .map((item: any) => ({
          entityKind,
          id: item.id,
          name: toTrimmedString(item.name),
          enabled: item.enabled !== false,
        }))
  }
}

async function loadYjsEntityMentionItems(
  entityKind: 'dashboard_layout' | 'watchlist',
  workspaceId: string,
  ownerUserId?: string | null
): Promise<WorkspaceEntityItem[]> {
  const ownerId = toTrimmedString(ownerUserId)
  if (entityKind === 'dashboard_layout' && !ownerId) return []

  const result = await bootstrapYjsProvider(
    buildEntityListDescriptor(
      entityKind,
      workspaceId,
      entityKind === 'dashboard_layout' ? { ownerUserId: ownerId } : undefined
    ),
    undefined,
    'read'
  )
  try {
    const items = getEntityListMembers(result.doc, entityKind).map((item) => ({
      entityKind,
      id: item.entityId,
      name: toTrimmedString(item.entityName),
      createdAt: toTrimmedString(item.createdAt) || undefined,
      updatedAt: toTrimmedString(item.updatedAt) || undefined,
      ...(entityKind === 'dashboard_layout'
        ? {
            ownerUserId: ownerId,
            sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : undefined,
            isActive: item.isActive === true,
          }
        : {}),
    }))
    return entityKind === 'dashboard_layout'
      ? sortDashboardLayoutMentionItems(items)
      : sortByRecent(items)
  } finally {
    result.dispose()
  }
}
