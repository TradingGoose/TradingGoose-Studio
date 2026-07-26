import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createLogger } from '@/lib/logs/console/logger'
import { generateCreativeWorkflowName } from '@/lib/naming'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('WorkflowQueries')

export const workflowKeys = {
  all: ['workflows'] as const,
  lists: () => [...workflowKeys.all, 'list'] as const,
  list: (workspaceId: string) => [...workflowKeys.lists(), workspaceId] as const,
}

interface CreateWorkflowVariables {
  workspaceId: string
  name?: string
  description?: string
  folderId?: string | null
}

export function useCreateWorkflow() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (variables: CreateWorkflowVariables) => {
      const { workspaceId, name, description, folderId } = variables

      logger.info(`Creating new workflow in workspace: ${workspaceId}`)
      const requestBody: Record<string, unknown> = {
        name: name || generateCreativeWorkflowName(),
        description: description || 'New workflow',
        workspaceId,
        folderId: folderId || null,
      }

      const createResponse = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })

      if (!createResponse.ok) {
        const errorData = await createResponse.json()
        throw new Error(
          `Failed to create workflow: ${errorData.error || createResponse.statusText}`
        )
      }

      const createdWorkflow = await createResponse.json()
      const workflowId = createdWorkflow.id

      logger.info(`Successfully created workflow ${workflowId}`)

      return {
        id: workflowId,
        name: createdWorkflow.name,
        description: createdWorkflow.description,
        color: createdWorkflow.color,
        workspaceId,
        folderId: createdWorkflow.folderId,
      }
    },
    onSuccess: (data, variables) => {
      logger.info(`Workflow ${data.id} created successfully`)

      useWorkflowRegistry.setState((state) => ({
        workflows: {
          ...state.workflows,
          [data.id]: {
            id: data.id,
            name: data.name,
            lastModified: new Date(),
            createdAt: new Date(),
            description: data.description,
            color: data.color,
            workspaceId: data.workspaceId,
            folderId: data.folderId,
          },
        },
        error: null,
      }))

      queryClient.invalidateQueries({ queryKey: workflowKeys.list(variables.workspaceId) })
    },
    onError: (error: Error) => {
      logger.error('Failed to create workflow:', error)
    },
  })
}
