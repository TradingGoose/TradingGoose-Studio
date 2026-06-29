import type { CopilotWorkspaceEntityKind } from '../../workspace-entities'
import type { WorkspaceEntityItem } from './types'

const sortByRecent = <T extends { createdAt?: string; updatedAt?: string }>(items: T[]) =>
  [...items].sort((left, right) => {
    const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime()
    const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime()
    return rightTime - leftTime
  })

const toTrimmedString = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export async function loadWorkspaceEntityMentionItems(
  entityKind: CopilotWorkspaceEntityKind,
  workspaceId: string
): Promise<WorkspaceEntityItem[]> {
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
