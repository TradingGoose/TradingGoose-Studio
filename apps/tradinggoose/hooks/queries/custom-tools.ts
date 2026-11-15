import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { CustomToolsImportFile } from '@/lib/custom-tools/import-export'
import { createLogger } from '@/lib/logs/console/logger'
import type { CustomToolDefinition, CustomToolSchema } from '@/stores/custom-tools/types'

const logger = createLogger('CustomToolsQueries')
const API_ENDPOINT = '/api/tools/custom'

/**
 * Query key factories for custom tools queries
 */
export const customToolsKeys = {
  all: ['customTools'] as const,
  lists: () => [...customToolsKeys.all, 'list'] as const,
  list: (workspaceId: string) => [...customToolsKeys.lists(), workspaceId] as const,
  detail: (toolId: string) => [...customToolsKeys.all, 'detail', toolId] as const,
  write: (workspaceId: string) => [...customToolsKeys.all, 'write', workspaceId] as const,
}

export const customToolWriteScope = (workspaceId: string) => `custom-tools:${workspaceId}`

type ApiCustomTool = Partial<CustomToolDefinition> & {
  id: string
  title: string
  workspaceId?: string
  schema: Partial<CustomToolSchema> & {
    function?: Partial<CustomToolSchema['function']> & {
      parameters?: Partial<CustomToolSchema['function']['parameters']>
    }
  }
  code?: string
}

function normalizeCustomTool(tool: ApiCustomTool, workspaceId: string): CustomToolDefinition {
  const title = tool.title.trim()
  if (!title) {
    throw new Error('Custom tool title is required')
  }

  const parameters = tool.schema.function?.parameters ?? {
    type: 'object',
    properties: {},
  }

  return {
    id: tool.id,
    title,
    code: typeof tool.code === 'string' ? tool.code : '',
    workspaceId: tool.workspaceId ?? workspaceId,
    userId: tool.userId ?? null,
    createdAt: typeof tool.createdAt === 'string' ? tool.createdAt : undefined,
    updatedAt: typeof tool.updatedAt === 'string' ? tool.updatedAt : undefined,
    schema: {
      type: tool.schema.type ?? 'function',
      function: {
        description: tool.schema.function?.description,
        parameters: {
          type: parameters.type ?? 'object',
          properties: parameters.properties ?? {},
          required: parameters.required,
        },
      },
    },
  }
}

/**
 * Fetch custom tools for a workspace
 */
async function fetchCustomTools(workspaceId: string): Promise<CustomToolDefinition[]> {
  const response = await fetch(`${API_ENDPOINT}?workspaceId=${workspaceId}`)

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || `Failed to fetch custom tools: ${response.statusText}`)
  }

  const { data } = await response.json()

  if (!Array.isArray(data)) {
    throw new Error('Invalid response format')
  }

  const normalizedTools: CustomToolDefinition[] = []

  data.forEach((tool, index) => {
    if (!tool || typeof tool !== 'object') {
      logger.warn(`Skipping invalid tool at index ${index}: not an object`)
      return
    }
    if (!tool.id || typeof tool.id !== 'string') {
      logger.warn(`Skipping invalid tool at index ${index}: missing or invalid id`)
      return
    }
    if (typeof tool.title !== 'string') {
      logger.warn(`Skipping invalid tool at index ${index}: missing or invalid title`)
      return
    }
    if (!tool.schema || typeof tool.schema !== 'object') {
      logger.warn(`Skipping invalid tool at index ${index}: missing or invalid schema`)
      return
    }
    if (!tool.schema.function || typeof tool.schema.function !== 'object') {
      logger.warn(`Skipping invalid tool at index ${index}: missing function schema`)
      return
    }

    const apiTool: ApiCustomTool = {
      id: tool.id,
      title: tool.title,
      schema: tool.schema,
      code: typeof tool.code === 'string' ? tool.code : '',
      workspaceId: tool.workspaceId ?? workspaceId,
      userId: tool.userId ?? null,
      createdAt: tool.createdAt ?? undefined,
      updatedAt: tool.updatedAt ?? undefined,
    }

    try {
      normalizedTools.push(normalizeCustomTool(apiTool, workspaceId))
    } catch (error) {
      logger.warn(`Failed to normalize custom tool at index ${index}`, { error })
    }
  })

  return normalizedTools
}

/**
 * Hook to fetch custom tools
 */
export function useCustomTools(workspaceId: string) {
  return useQuery<CustomToolDefinition[]>({
    queryKey: customToolsKeys.list(workspaceId),
    queryFn: () => fetchCustomTools(workspaceId),
    enabled: !!workspaceId,
    staleTime: 60 * 1000, // 1 minute - tools don't change frequently
    placeholderData: keepPreviousData,
  })
}

export interface CreateCustomToolInput {
  workspaceId: string
  tool: {
    title: string
    schema: CustomToolSchema
    code: string
  }
}

export async function createCustomTool({
  workspaceId,
  tool,
}: CreateCustomToolInput): Promise<Array<{ id: string }>> {
  logger.info(`Creating custom tool: ${tool.title} in workspace ${workspaceId}`)
  const response = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tools: [tool], workspaceId }),
  })
  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error || 'Failed to create tool')
  }
  if (!Array.isArray(data.data)) {
    throw new Error('Invalid API response: missing tools data')
  }

  logger.info(`Created custom tool: ${tool.title}`)
  return data.data
}

export interface ImportCustomToolsInput {
  workspaceId: string
  file: CustomToolsImportFile
}

export async function importCustomTools({
  workspaceId,
  file,
}: ImportCustomToolsInput): Promise<void> {
  logger.info(`Importing custom tools into workspace ${workspaceId}`)
  const response = await fetch(`${API_ENDPOINT}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId, file }),
  })
  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error || 'Failed to import custom tools')
  }
}

export interface DeleteCustomToolInput {
  workspaceId: string
  toolId: string
}

export async function deleteCustomTool({
  workspaceId,
  toolId,
}: DeleteCustomToolInput): Promise<void> {
  logger.info(`Deleting custom tool: ${toolId}`)
  const response = await fetch(`${API_ENDPOINT}?id=${toolId}&workspaceId=${workspaceId}`, {
    method: 'DELETE',
  })
  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error || 'Failed to delete tool')
  }

  logger.info(`Deleted custom tool: ${toolId}`)
}
