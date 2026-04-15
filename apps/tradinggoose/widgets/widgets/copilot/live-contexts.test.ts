import { describe, expect, it } from 'vitest'
import {
  areCopilotContextsEqual,
  extractExplicitCopilotContexts,
  mergeCopilotContexts,
} from '@/lib/copilot/chat-contexts'
import { buildImplicitCopilotContexts } from './live-contexts'

describe('buildImplicitCopilotContexts', () => {
  it('emits all current entity contexts alongside the workflow', () => {
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

  it('keeps non-workflow entity contexts even when the pair store has no workflow id', () => {
    expect(
      buildImplicitCopilotContexts({
        workspaceId: 'workspace-1',
        pairContext: {
          skillId: 'skill-1',
        },
      })
    ).toEqual([
      {
        kind: 'current_skill',
        skillId: 'skill-1',
        workspaceId: 'workspace-1',
        label: 'Current Skill',
      },
    ])
  })

  it('does not use review target state to infer the current entities', () => {
    expect(
      buildImplicitCopilotContexts({
        workspaceId: 'workspace-1',
        pairContext: {
          workflowId: 'workflow-pair',
          indicatorId: 'indicator-stale',
          skillId: 'skill-live',
          customToolId: 'tool-stale',
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
        label: 'Current Workflow',
      },
      {
        kind: 'current_skill',
        skillId: 'skill-live',
        workspaceId: 'workspace-1',
        label: 'Current Skill',
      },
      {
        kind: 'current_custom_tool',
        customToolId: 'tool-stale',
        workspaceId: 'workspace-1',
        label: 'Current Tool',
      },
      {
        kind: 'current_indicator',
        indicatorId: 'indicator-stale',
        workspaceId: 'workspace-1',
        label: 'Current Indicator',
      },
    ])
  })
})

describe('copilot context helpers', () => {
  it('keeps explicit mentions and appends only non-duplicated hidden live contexts', () => {
    expect(
      mergeCopilotContexts({
        explicitContexts: [
          {
            kind: 'workflow',
            workflowId: 'workflow-1',
            label: 'Quarterly Review',
          },
          {
            kind: 'workflow',
            workflowId: 'workflow-2',
            label: 'Momentum Screener',
          },
        ],
        implicitContexts: [
          {
            kind: 'current_workflow',
            workflowId: 'workflow-1',
            label: 'Current Workflow',
          },
          {
            kind: 'current_skill',
            skillId: 'skill-1',
            workspaceId: 'workspace-1',
            label: 'Current Skill',
          },
        ],
      })
    ).toEqual([
      {
        kind: 'workflow',
        workflowId: 'workflow-1',
        label: 'Quarterly Review',
      },
      {
        kind: 'workflow',
        workflowId: 'workflow-2',
        label: 'Momentum Screener',
      },
      {
        kind: 'current_skill',
        skillId: 'skill-1',
        workspaceId: 'workspace-1',
        label: 'Current Skill',
      },
    ])
  })

  it('strips hidden current contexts back out when deriving explicit message contexts', () => {
    expect(
      extractExplicitCopilotContexts([
        {
          kind: 'workflow',
          workflowId: 'workflow-1',
          label: 'Quarterly Review',
        },
        {
          kind: 'current_workflow',
          workflowId: 'workflow-1',
          label: 'Current Workflow',
        },
        {
          kind: 'current_indicator',
          indicatorId: 'indicator-1',
          workspaceId: 'workspace-1',
          label: 'Current Indicator',
        },
      ])
    ).toEqual([
      {
        kind: 'workflow',
        workflowId: 'workflow-1',
        label: 'Quarterly Review',
      },
    ])
  })

  it('deduplicates canonical block contexts by sorted blockIds', () => {
    expect(
      mergeCopilotContexts({
        explicitContexts: [
          { kind: 'blocks', blockIds: ['block-2', 'block-1'], label: 'RSI + MACD' },
          { kind: 'blocks', blockIds: ['block-1', 'block-2'], label: 'Duplicate Ordering' },
        ],
      })
    ).toEqual([
      {
        kind: 'blocks',
        blockIds: ['block-2', 'block-1'],
        label: 'RSI + MACD',
      },
    ])
  })

  it('compares canonical block contexts directly by content and order', () => {
    expect(
      areCopilotContextsEqual(
        [{ kind: 'blocks', blockIds: ['block-1'], label: 'RSI' }],
        [{ kind: 'blocks', blockIds: ['block-1'], label: 'RSI' }]
      )
    ).toBe(true)
  })
})
