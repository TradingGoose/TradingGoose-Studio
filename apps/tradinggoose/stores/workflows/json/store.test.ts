import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSkillsStore } from '@/stores/skills/store'

const mockGetSnapshotForWorkflow = vi.hoisted(() => vi.fn())

vi.mock('@/lib/yjs/workflow-session-registry', () => ({
  getSnapshotForWorkflow: mockGetSnapshotForWorkflow,
}))

import { useWorkflowJsonStore } from './store'

describe('workflow json store', () => {
  beforeEach(() => {
    mockGetSnapshotForWorkflow.mockReset()
    useSkillsStore.getState().resetAll()
    useWorkflowJsonStore.setState({
      json: '',
    })

    mockGetSnapshotForWorkflow.mockReturnValue({
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
      lastSaved: undefined,
      isDeployed: false,
      deployedAt: undefined,
    })
    useSkillsStore.getState().setSkills('workspace-1', [
      {
        id: 'skill-1',
        workspaceId: 'workspace-1',
        userId: null,
        name: ' Market Research ',
        description: ' Research the market before execution. ',
        content: 'Review catalysts and confirm direction.',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'skill-2',
        workspaceId: 'workspace-1',
        userId: null,
        name: 'Unused Skill',
        description: 'Not referenced.',
        content: 'Do not export this skill.',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ])
  })

  it('threads workspace skills into the workflow export payload', async () => {
    await useWorkflowJsonStore.getState().getJson({
      workflowId: 'workflow-1',
      name: 'Primary Workflow',
      description: 'Workflow imported from the unified schema',
      workspaceId: 'workspace-1',
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
