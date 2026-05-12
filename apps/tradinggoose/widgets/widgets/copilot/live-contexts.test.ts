import { describe, expect, it } from 'vitest'
import {
  buildCopilotEditableReviewTargetRequest,
  buildImplicitCopilotContexts,
  buildCopilotLiveReviewTarget,
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
          reviewEntityKind: 'skill',
          reviewEntityId: 'skill-live',
          reviewSessionId: 'review-skill-1',
          reviewDraftSessionId: 'draft-skill-1',
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
      reviewEntityKind: 'workflow' as const,
      reviewEntityId: 'workflow-review',
      reviewSessionId: 'review-workflow-1',
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

  it('does not emit current context for review-target-only payloads', () => {
    expect(
      buildImplicitCopilotContexts({
        workspaceId: 'workspace-1',
        pairContext: {
          reviewEntityKind: 'skill',
          reviewDraftSessionId: 'draft-skill',
        },
      })
    ).toEqual([])
  })
})

describe('buildCopilotEditableReviewTargetRequest', () => {
  it('does not emit plain non-workflow entity selections as editable requests', () => {
    expect(
      buildCopilotEditableReviewTargetRequest({
        pairContext: {
          workflowId: 'workflow-pair',
          skillId: 'skill-1',
          indicatorId: 'indicator-1',
        },
      })
    ).toBeNull()
  })

  it('emits canonical non-workflow review metadata as an editable request', () => {
    expect(
      buildCopilotEditableReviewTargetRequest({
        pairContext: {
          reviewEntityKind: 'indicator',
          reviewEntityId: null,
          reviewSessionId: 'review-indicator-1',
          reviewDraftSessionId: 'draft-indicator-1',
        },
      })
    ).toEqual({
      entityKind: 'indicator',
      entityId: null,
      reviewSessionId: 'review-indicator-1',
      draftSessionId: 'draft-indicator-1',
    })
  })

  it('does not request entity review mounting for workflow review metadata', () => {
    expect(
      buildCopilotEditableReviewTargetRequest({
        pairContext: {
          reviewEntityKind: 'workflow',
          reviewEntityId: 'workflow-review',
          reviewSessionId: 'review-workflow-1',
        },
      })
    ).toBeNull()
  })
})

describe('buildCopilotLiveReviewTarget', () => {
  it('derives editable runtime provenance only from resolved entity review descriptors', () => {
    expect(
      buildCopilotLiveReviewTarget({
        workspaceId: 'workspace-1',
        entityKind: 'skill',
        entityId: null,
        reviewSessionId: 'review-skill-1',
        draftSessionId: 'draft-skill-1',
        yjsSessionId: 'review-skill-1',
      })
    ).toEqual({
      entityKind: 'skill',
      entityId: null,
      reviewSessionId: 'review-skill-1',
      draftSessionId: 'draft-skill-1',
    })
  })

  it('does not expose non-entity descriptors as live edit provenance', () => {
    expect(
      buildCopilotLiveReviewTarget({
        workspaceId: 'workspace-1',
        entityKind: 'workflow',
        entityId: 'workflow-1',
        reviewSessionId: 'review-workflow-1',
        draftSessionId: null,
        yjsSessionId: 'workflow-1',
      })
    ).toBeNull()
  })
})
