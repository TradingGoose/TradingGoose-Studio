import type { CopilotWorkspaceEntityKind } from '../../workspace-entities'
import type { WorkspaceEntityItem } from './types'

const sortByRecent = <T extends { createdAt?: string; updatedAt?: string }>(items: T[]) =>
  [...items].sort((left, right) => {
    const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime()
    const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime()
    return rightTime - leftTime
  })

export function getWorkspaceEntityMentionEmptyState(
  entityKind: CopilotWorkspaceEntityKind
): string {
  switch (entityKind) {
    case 'workflow':
      return 'No workflows'
    case 'skill':
      return 'No skills'
    case 'indicator':
      return 'No indicators'
    case 'custom_tool':
      return 'No custom tools'
    case 'mcp_server':
      return 'No MCP servers'
  }
}

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
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(`Failed to load ${entityKind}: ${response.status}`)
  }

  switch (entityKind) {
    case 'workflow':
      return sortByRecent(Array.isArray(data?.data) ? data.data : []).map((item: any) => ({
        entityKind,
        id: item.id,
        name: item.name || 'Untitled Workflow',
        color: item.color,
      }))
    case 'skill':
      return sortByRecent(Array.isArray(data?.data) ? data.data : []).map((item: any) => ({
        entityKind,
        id: item.id,
        name: item.name || 'Untitled Skill',
        description: item.description || '',
      }))
    case 'indicator':
      return sortByRecent(Array.isArray(data?.data) ? data.data : []).map((item: any) => ({
        entityKind,
        id: item.id,
        name: item.name || 'Untitled Indicator',
        color: item.color,
      }))
    case 'custom_tool':
      return sortByRecent(Array.isArray(data?.data) ? data.data : []).map((item: any) => ({
        entityKind,
        id: item.id,
        name: item.title || item.schema?.function?.name || 'Untitled Tool',
        description: item.schema?.function?.description || '',
        functionName: item.schema?.function?.name || '',
      }))
    case 'mcp_server':
      return sortByRecent(Array.isArray(data?.data?.servers) ? data.data.servers : []).map(
        (item: any) => ({
          entityKind,
          id: item.id,
          name: item.name || 'Untitled MCP Server',
          description: item.description || '',
          transport: item.transport || 'http',
          enabled: item.enabled,
          connectionStatus: item.connectionStatus,
        })
      )
  }
}
