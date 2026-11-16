import type { MemoryResponse } from '@/tools/memory/types'
import type { ToolConfig } from '@/tools/types'

export const memoryDeleteTool: ToolConfig<any, MemoryResponse> = {
  id: 'memory_delete',
  name: 'Delete Memory',
  description: 'Delete the conversation and its messages from memory.',
  version: '1.0.0',

  params: {
    id: {
      type: 'string',
      required: true,
      description: 'Identifier for the memory to delete',
    },
  },

  request: {
    url: (params) => `/api/memory/${encodeURIComponent(params.id)}`,
    method: 'DELETE',
    headers: () => ({}),
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
