import type { MemoryResponse } from '@/tools/memory/types'
import type { ToolConfig } from '@/tools/types'

export const memoryGetTool: ToolConfig<any, MemoryResponse> = {
  id: 'memory_get',
  name: 'Get Memory',
  description: 'Retrieve a specific memory by its ID',
  version: '1.0.0',

  params: {
    id: {
      type: 'string',
      required: true,
      description: 'Identifier for the memory to retrieve',
    },
  },

  request: {
    url: (params) => {
      const workflowId = params._context?.workflowId
      if (!workflowId) {
        throw new Error('workflowId is required in execution context')
      }
      return `/api/memory/${encodeURIComponent(params.id)}?workflowId=${encodeURIComponent(workflowId)}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<MemoryResponse> => {
    const { data } = await response.json()

    return {
      success: true,
      output: {
        memories: data.data,
        message: 'Memory retrieved successfully',
      },
    }
  },

  outputs: {
    memories: { type: 'array', description: 'Array of memory data for the requested ID' },
    message: { type: 'string', description: 'Success or error message' },
  },
}
