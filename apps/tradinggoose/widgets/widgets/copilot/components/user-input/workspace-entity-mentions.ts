import type { CopilotWorkspaceEntityKind } from '../../workspace-entities'
import type { WorkspaceEntityItem } from './types'

const sortByRecent = <T extends { createdAt?: string; updatedAt?: string }>(items: T[]) =>
  [...items].sort((left, right) => {
    const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime()
    const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime()
    return rightTime - leftTime
  })

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
      return sortByRecent(Array.isArray(data?.data) ? data.data : []).flatMap((item: any) =>
        item.id
          ? [
              {
                entityKind,
                id: item.id,
                name: item.name || '',
                color: item.color,
              },
            ]
          : []
      )
    case 'skill':
      return sortByRecent(Array.isArray(data?.data) ? data.data : []).map((item: any) => ({
        entityKind,
        id: item.id,
        name: item.name || '',
        description: item.description || '',
      }))
    case 'indicator':
      return sortByRecent(Array.isArray(data?.data) ? data.data : []).map((item: any) => ({
        entityKind,
        id: item.id,
        name: item.name || '',
        color: item.color,
      }))
    case 'custom_tool':
      return sortByRecent(Array.isArray(data?.data) ? data.data : []).map((item: any) => ({
        entityKind,
        id: item.id,
        name: item.title || item.schema?.function?.name || '',
        description: item.schema?.function?.description || '',
        functionName: item.schema?.function?.name || '',
      }))
    case 'mcp_server':
      return sortByRecent(Array.isArray(data?.data?.servers) ? data.data.servers : []).map(
        (item: any) => ({
          entityKind,
          id: item.id,
          name: item.name || '',
          description: item.description || '',
          transport: item.transport || 'http',
          enabled: item.enabled,
          connectionStatus: item.connectionStatus,
        })
      )
  }
}
