import type { MemoryResponse } from '@/tools/memory/types'
import type { ToolConfig } from '@/tools/types'

export const memoryGetAllTool: ToolConfig<any, MemoryResponse> = {
  id: 'memory_get_all',
  name: 'Get All Memories',
  description: 'Retrieve up to 50 conversations stored in the current workflow.',
  version: '1.0.0',

  params: {},

  request: {
    url: '/api/memory',
    method: 'GET',
    headers: () => ({}),
  },

  transformResponse: async (response): Promise<MemoryResponse> => {
    const { data } = await response.json()

    return {
      success: true,
      output: {
        memories: data.memories.map((memory: any) => ({
          key: memory.key,
          type: memory.type,
          data: memory.data,
        })),
        message: 'Memories retrieved successfully',
      },
    }
  },

  outputs: {
    memories: {
      type: 'array',
      description: 'Up to 50 conversation objects with keys, types, and message data',
    },
    message: { type: 'string', description: 'Success or error message' },
  },
}
