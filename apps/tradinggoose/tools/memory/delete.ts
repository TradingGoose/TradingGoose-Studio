import type { MemoryResponse } from '@/tools/memory/types'
import type { ToolConfig } from '@/tools/types'

export const memoryDeleteTool: ToolConfig<any, MemoryResponse> = {
  id: 'memory_delete',
  name: 'Delete Memory',
  description: 'Delete a specific memory by its ID',
  version: '1.0.0',

  params: {
    id: {
      type: 'string',
      required: true,
      description: 'Identifier for the memory to delete',
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
    method: 'DELETE',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },
  transformResponse: async (): Promise<MemoryResponse> => {
    return {
      success: true,
      output: {
        message: 'Memory deleted successfully.',
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
  },
}
