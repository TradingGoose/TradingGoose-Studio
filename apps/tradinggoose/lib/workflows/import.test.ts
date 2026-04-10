import { describe, expect, it, vi } from 'vitest'
import { importWorkflowFromJsonContent } from '@/lib/workflows/import'

describe('workflow import orchestration', () => {
  it('creates the workflow row before persisting the imported state', async () => {
    const payload = {
      version: '1',
      fileType: 'tradingGooseExport',
      exportedAt: '2026-04-08T15:30:00.000Z',
      exportedFrom: 'workflowEditor',
      resourceTypes: ['workflows'],
      skills: [],
      workflows: [
        {
          name: 'Primary Workflow',
          description: 'Workflow imported from the unified schema',
          color: '#3972F6',
          state: {
            blocks: {
              block_1: {
                id: 'block_1',
                type: 'agent',
                name: 'Agent 1',
                position: { x: 0, y: 0 },
                subBlocks: {},
                outputs: {},
                enabled: true,
              },
            },
            edges: [],
            loops: {},
            parallels: {},
          },
        },
      ],
      customTools: [],
      watchlists: [],
      indicators: [],
    }

    const callOrder: string[] = []

    const createWorkflow = vi.fn(
      async (params: {
        name: string
        description: string
        workspaceId: string
        color?: string
      }) => {
        callOrder.push('createWorkflow')
        expect(params).toMatchObject({
          name: 'Primary Workflow (imported) 1',
          description: 'Workflow imported from the unified schema',
          color: '#3972F6',
          workspaceId: 'workspace-1',
        })
        return 'workflow-1'
      }
    )

    const persistWorkflowState = vi.fn(async (workflowId: string, state: unknown) => {
      callOrder.push('persistWorkflowState')
      expect(workflowId).toBe('workflow-1')
      expect(state).toMatchObject({
        edges: [],
        loops: {},
        parallels: {},
      })

      expect(Object.keys((state as { blocks: Record<string, unknown> }).blocks)).toHaveLength(1)

      const [firstBlock] = Object.values(
        (state as { blocks: Record<string, { type: string; name: string }> }).blocks
      )
      expect(firstBlock).toMatchObject({
        type: 'agent',
        name: 'Agent 1',
      })
    })

    const workflowId = await importWorkflowFromJsonContent({
      content: JSON.stringify(payload),
      filename: 'Primary Workflow.json',
      workspaceId: 'workspace-1',
      existingWorkflowNames: ['Primary Workflow'],
      createWorkflow,
      persistWorkflowState,
    })

    expect(workflowId).toBe('workflow-1')
    expect(callOrder).toEqual(['createWorkflow', 'persistWorkflowState'])
    expect(createWorkflow).toHaveBeenCalledTimes(1)
    expect(persistWorkflowState).toHaveBeenCalledTimes(1)
  })

  it('relinks imported skills into workflow blocks before persisting', async () => {
    const payload = {
      version: '1',
      fileType: 'tradingGooseExport',
      exportedAt: '2026-04-08T15:30:00.000Z',
      exportedFrom: 'workflowEditor',
      resourceTypes: ['workflows', 'skills'],
      skills: [
        {
          name: 'Market Research',
          description: 'Research the market before execution.',
          content: 'Review catalysts and confirm direction.',
        },
        {
          name: 'Execution Plan',
          description: 'Create an execution plan.',
          content: 'Follow the checklist.',
        },
      ],
      workflows: [
        {
          name: 'Primary Workflow',
          description: 'Workflow imported from the unified schema',
          color: '#3972F6',
          state: {
            blocks: {
              block_1: {
                id: 'block_1',
                type: 'agent',
                name: 'Agent 1',
                position: { x: 0, y: 0 },
                subBlocks: {
                  skills: {
                    id: 'skills',
                    type: 'skill-input',
                    value: [
                      {
                        skillId: 'old-skill-1',
                        name: 'Market Research',
                      },
                      {
                        skillId: 'old-skill-2',
                        name: 'Execution Plan',
                      },
                    ],
                  },
                },
                outputs: {},
                enabled: true,
              },
            },
            edges: [],
            loops: {},
            parallels: {},
          },
        },
      ],
      customTools: [],
      watchlists: [],
      indicators: [],
    }

    const importedSkillsBySourceName = new Map([
      [
        'Market Research',
        {
          skillId: 'skill-1',
          name: 'Market Research (imported) 1',
        },
      ],
      [
        'Execution Plan',
        {
          skillId: 'skill-2',
          name: 'Execution Plan',
        },
      ],
    ])

    const createWorkflow = vi.fn(
      async (params: {
        name: string
        description: string
        workspaceId: string
        color?: string
      }) => {
        expect(params).toMatchObject({
          name: 'Primary Workflow (imported) 1',
          description: 'Workflow imported from the unified schema',
          color: '#3972F6',
          workspaceId: 'workspace-1',
        })
        return 'workflow-1'
      }
    )

    const persistWorkflowState = vi.fn(async (workflowId: string, state: unknown) => {
      expect(workflowId).toBe('workflow-1')

      const workflowState = state as {
        blocks: Record<
          string,
          {
            subBlocks?: Record<
              string,
              {
                value?: Array<{ skillId: string; name: string }>
              }
            >
          }
        >
      }

      const [firstBlock] = Object.values(workflowState.blocks)

      expect(firstBlock?.subBlocks?.skills?.value).toEqual([
        {
          skillId: 'skill-1',
          name: 'Market Research (imported) 1',
        },
        {
          skillId: 'skill-2',
          name: 'Execution Plan',
        },
      ])
    })

    const workflowId = await importWorkflowFromJsonContent({
      content: JSON.stringify(payload),
      filename: 'Primary Workflow.json',
      workspaceId: 'workspace-1',
      existingWorkflowNames: ['Primary Workflow'],
      importedSkillsBySourceName,
      createWorkflow,
      persistWorkflowState,
    })

    expect(workflowId).toBe('workflow-1')
    expect(createWorkflow).toHaveBeenCalledTimes(1)
    expect(persistWorkflowState).toHaveBeenCalledTimes(1)
  })
})
