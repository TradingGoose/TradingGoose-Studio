import { readWorkflowMemoryTransport } from '@/lib/mastra/workflow-message-source'
import type { MemoryResponse } from '@/tools/memory/types'
import type { ToolConfig } from '@/tools/types'

export const memoryGetAllTool: ToolConfig<any, MemoryResponse> = {
  id: 'memory_get_all',
  name: 'Get All Memories',
  description: 'Retrieve up to 50 conversations stored in the current workflow.',
  version: '1.0.0',

  params: {},

  request: {
    url: (params) => {
      const workflowId = params._context?.workflowId
      if (!workflowId) {
        throw new Error('workflowId is required in execution context')
      }
      return `/api/memory?workflowId=${encodeURIComponent(workflowId)}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<MemoryResponse> => {
    const { data } = await response.json()

    // Transform memories to return them with their keys and types for better context
    const memories = await Promise.all(
      data.memories.map(async (memory: any) => ({
        key: memory.key,
        type: memory.type,
        data: await readWorkflowMemoryTransport(memory),
      }))
    )

    return {
      success: true,
      output: {
        memories,
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
