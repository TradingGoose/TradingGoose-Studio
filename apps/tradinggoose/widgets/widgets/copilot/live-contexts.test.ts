import { describe, expect, it } from 'vitest'
import {
  buildCopilotEditableReviewTargets,
  buildImplicitCopilotContexts,
  resolveCopilotWorkflowId,
} from './live-contexts'

describe('buildImplicitCopilotContexts', () => {
  it('emits current workflow and entity contexts from pair state', () => {
    expect(
      buildImplicitCopilotContexts({
        workspaceId: 'workspace-1',
        pairContext: {
          workflowId: 'workflow-pair',
          indicatorId: 'indicator-1',
          skillId: 'skill-1',
          customToolId: 'tool-1',
          mcpServerId: 'mcp-1',
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
      {
        kind: 'current_custom_tool',
        customToolId: 'tool-1',
        workspaceId: 'workspace-1',
        label: 'Current Tool',
      },
      {
        kind: 'current_indicator',
        indicatorId: 'indicator-1',
        workspaceId: 'workspace-1',
        label: 'Current Indicator',
      },
      {
        kind: 'current_mcp_server',
        mcpServerId: 'mcp-1',
        workspaceId: 'workspace-1',
        label: 'Current MCP Server',
      },
    ])
  })

  it('does not attach review metadata to current entity context', () => {
    expect(
      buildImplicitCopilotContexts({
        workspaceId: 'workspace-1',
        pairContext: {
          workflowId: 'workflow-pair',
          indicatorId: 'indicator-stale',
          skillId: 'skill-live',
          reviewTarget: {
            reviewEntityKind: 'skill',
            reviewEntityId: 'skill-live',
            reviewSessionId: 'review-skill-1',
            reviewDraftSessionId: 'draft-skill-1',
          },
        } as any,
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
        skillId: 'skill-live',
        workspaceId: 'workspace-1',
        label: 'Current Skill',
      },
      {
        kind: 'current_indicator',
        indicatorId: 'indicator-stale',
        workspaceId: 'workspace-1',
        label: 'Current Indicator',
      },
    ])
  })

  it('uses only pair workflow id for current workflow context', () => {
    const pairContext = {
      workflowId: 'workflow-pair',
      reviewTarget: {
        reviewEntityKind: 'workflow',
        reviewEntityId: 'workflow-review',
        reviewSessionId: 'review-workflow-1',
        reviewDraftSessionId: null,
      },
    } as any

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

  it('does not emit current context for draft-only review targets', () => {
    expect(
      buildImplicitCopilotContexts({
        workspaceId: 'workspace-1',
        pairContext: {
          reviewTarget: {
            reviewEntityKind: 'skill',
            reviewEntityId: null,
            reviewSessionId: null,
            reviewDraftSessionId: 'draft-skill',
          },
        } as any,
      })
    ).toEqual([])
  })
})

describe('buildCopilotEditableReviewTargets', () => {
  it('does not emit plain non-workflow entity selections as editable targets', () => {
    expect(
      buildCopilotEditableReviewTargets({
        pairContext: {
          workflowId: 'workflow-pair',
          skillId: 'skill-1',
          indicatorId: 'indicator-1',
        },
      })
    ).toEqual([])
  })

  it('preserves saved and draft entity review targets', () => {
    expect(
      buildCopilotEditableReviewTargets({
        pairContext: {
          reviewTarget: {
            reviewEntityKind: 'indicator',
            reviewEntityId: null,
            reviewSessionId: 'review-indicator-1',
            reviewDraftSessionId: 'draft-indicator-1',
          },
        } as any,
      })
    ).toEqual([
      {
        entityKind: 'indicator',
        entityId: null,
        reviewSessionId: 'review-indicator-1',
        draftSessionId: 'draft-indicator-1',
      },
    ])
  })

  it('keeps editable review targets separate from current entity ids', () => {
    expect(
      buildCopilotEditableReviewTargets({
        pairContext: {
          skillId: 'skill-saved',
          reviewTarget: {
            reviewEntityKind: 'skill',
            reviewEntityId: null,
            reviewSessionId: 'review-draft-skill',
            reviewDraftSessionId: 'draft-skill',
          },
        } as any,
      })
    ).toEqual([
      {
        entityKind: 'skill',
        entityId: null,
        reviewSessionId: 'review-draft-skill',
        draftSessionId: 'draft-skill',
      },
    ])
  })
})
