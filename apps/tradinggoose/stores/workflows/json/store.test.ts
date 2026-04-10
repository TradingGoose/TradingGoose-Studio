import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetWorkflowWithValues = vi.hoisted(() => vi.fn())

vi.mock('@/stores/workflows', () => ({
  getWorkflowWithValues: mockGetWorkflowWithValues,
}))

import { useWorkflowJsonStore } from './store'

describe('workflow json store', () => {
  beforeEach(() => {
    mockGetWorkflowWithValues.mockReset()
    useWorkflowJsonStore.setState({
      json: '',
      lastGenerated: undefined,
    })

    mockGetWorkflowWithValues.mockReturnValue({
      id: 'workflow-1',
      name: 'Primary Workflow',
      description: 'Workflow imported from the unified schema',
      color: '#3972F6',
      workspaceId: 'workspace-1',
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
                    skillId: 'skill-1',
                    name: 'Market Research',
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
    })
  })

  it('threads workspace skills into the workflow export payload', async () => {
    await useWorkflowJsonStore.getState().getJson({
      workflowId: 'workflow-1',
      channelId: 'channel-1',
      workspaceSkills: [
        {
          id: 'skill-1',
          name: ' Market Research ',
          description: ' Research the market before execution. ',
          content: 'Review catalysts and confirm direction.',
        },
      ],
    })

    const payload = JSON.parse(useWorkflowJsonStore.getState().json) as {
      resourceTypes: string[]
      skills: Array<{
        name: string
        description: string
        content: string
      }>
      workflows: Array<{
        state: {
          blocks: Record<
            string,
            {
              subBlocks?: Record<
                string,
                {
                  value?: Array<{
                    skillId: string
                    name: string
                  }>
                }
              >
            }
          >
        }
      }>
    }

    expect(payload.resourceTypes).toEqual(['workflows', 'skills'])
    expect(payload.skills).toEqual([
      {
        name: 'Market Research',
        description: 'Research the market before execution.',
        content: 'Review catalysts and confirm direction.',
      },
    ])
    expect(payload.workflows[0]?.state.blocks.block_1.subBlocks?.skills?.value).toEqual([
      {
        skillId: 'skill-1',
        name: 'Market Research',
      },
    ])
  })
})
