import type { MemoryResponse } from '@/tools/memory/types'
import type { ToolConfig } from '@/tools/types'

export const memoryAddTool: ToolConfig<any, MemoryResponse> = {
  id: 'memory_add',
  name: 'Add Memory',
  description: 'Add a new memory to the database or append to existing memory with the same ID.',
  version: '1.0.0',

  execution: { workspace: { required: true, access: 'write' } },

  params: {
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Conversation identifier within the current workflow. Reusing the ID appends the message to that conversation.',
    },
    role: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Role for agent memory (user, assistant, or system)',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Content for agent memory',
    },
  },

  request: {
    url: '/api/memory',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const workflowId = params._context?.workflowId
      if (!workflowId) {
        throw new Error('workflowId is required in execution context')
      }

      if (!params.id) {
        throw new Error('id is required')
      }

      return {
        key: params.id,
        type: 'agent',
        workflowId,
        data: {
          role: params.role,
          content: params.content,
        },
      }
    },
  },

  transformResponse: async (response): Promise<MemoryResponse> => {
    const { data } = await response.json()

    return {
      success: true,
      output: {
        memories: data.data,
      },
    }
  },

  outputs: {
    memories: {
      type: 'array',
      description: 'Array of memory objects including the new or updated memory',
    },
  },
}
