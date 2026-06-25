import { describe, expect, it, vi } from 'vitest'
import { importWorkflowFromJsonContent } from '@/lib/workflows/import'

describe('workflow import orchestration', () => {
  it('creates the workflow with imported state as creation-time initialization', async () => {
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
        initialWorkflowState: any
      }) => {
        callOrder.push('createWorkflow')
        expect(params).toMatchObject({
          name: 'Primary Workflow (imported) 1',
          description: 'Workflow imported from the unified schema',
          workspaceId: 'workspace-1',
          initialWorkflowState: {
            edges: [],
            loops: {},
            parallels: {},
          },
        })
        expect(Object.keys(params.initialWorkflowState.blocks)).toHaveLength(1)
        return 'workflow-1'
      }
    )

    const workflowId = await importWorkflowFromJsonContent({
      content: JSON.stringify(payload),
      workspaceId: 'workspace-1',
      existingWorkflowNames: ['Primary Workflow'],
      createWorkflow,
    })

    expect(workflowId).toBe('workflow-1')
    expect(callOrder).toEqual(['createWorkflow'])
    expect(createWorkflow).toHaveBeenCalledTimes(1)
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
            variables: {
              'var-1': {
                id: 'var-1',
                workflowId: 'workflow-source',
                name: 'risk',
                type: 'plain',
                value: 'medium',
              },
            },
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
        initialWorkflowState: any
      }) => {
        expect(params).toMatchObject({
          name: 'Primary Workflow (imported) 1',
          description: 'Workflow imported from the unified schema',
          workspaceId: 'workspace-1',
        })

        const workflowState = params.initialWorkflowState as {
          variables: Record<string, unknown>
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

        expect(workflowState.variables).toEqual({
          'var-1': {
            id: 'var-1',
            workflowId: 'workflow-source',
            name: 'risk',
            type: 'plain',
            value: 'medium',
          },
        })

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
        return 'workflow-1'
      }
    )

    const workflowId = await importWorkflowFromJsonContent({
      content: JSON.stringify(payload),
      workspaceId: 'workspace-1',
      existingWorkflowNames: ['Primary Workflow'],
      importedSkillsBySourceName,
      createWorkflow,
    })

    expect(workflowId).toBe('workflow-1')
    expect(createWorkflow).toHaveBeenCalledTimes(1)
  })
})
