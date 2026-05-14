import { describe, expect, it } from 'vitest'
import { buildImplicitCopilotContexts, resolveCopilotWorkflowId } from './live-contexts'

describe('buildImplicitCopilotContexts', () => {
  it('emits current workflow and active editable entity contexts from pair state', () => {
    expect(
      buildImplicitCopilotContexts({
        workspaceId: 'workspace-1',
        pairContext: {
          workflowId: 'workflow-pair',
          skillId: 'skill-1',
        },
      })
    ).toEqual([
      {
        kind: 'current_workflow',
        workflowId: 'workflow-pair',
        workspaceId: 'workspace-1',
        label: 'Current Workflow',
      },
      {
        kind: 'current_skill',
        skillId: 'skill-1',
        workspaceId: 'workspace-1',
        label: 'Current Skill',
      },
    ])
  })

  it('uses only pair workflow id for current workflow context', () => {
    const pairContext = {
      workflowId: 'workflow-pair',
    }

    expect(resolveCopilotWorkflowId(pairContext)).toBe('workflow-pair')
    expect(
      buildImplicitCopilotContexts({
        workspaceId: 'workspace-1',
        pairContext,
      })
    ).toEqual([
      {
        kind: 'current_workflow',
        workflowId: 'workflow-pair',
        workspaceId: 'workspace-1',
        label: 'Current Workflow',
      },
    ])
  })

  it('does not emit current context without selected entity ids', () => {
    expect(
      buildImplicitCopilotContexts({
        workspaceId: 'workspace-1',
        pairContext: {},
      })
    ).toEqual([])
  })
})
