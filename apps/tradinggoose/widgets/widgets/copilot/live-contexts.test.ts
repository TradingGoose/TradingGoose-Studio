import { describe, expect, it } from 'vitest'
import { buildImplicitCopilotContexts, resolveCopilotWorkflowId } from './live-contexts'

const currentLabels = {
  workflow: 'Localized Workflow',
  skill: 'Localized Skill',
  custom_tool: 'Localized Tool',
  indicator: 'Localized Indicator',
  mcp_server: 'Localized MCP Server',
  watchlist: 'Localized Watchlist',
}

describe('buildImplicitCopilotContexts', () => {
  it('emits current workflow and active editable entity contexts from pair state', () => {
    expect(
      buildImplicitCopilotContexts({
        workspaceId: 'workspace-1',
        pairContext: {
          workflowId: 'workflow-pair',
          skillId: 'skill-1',
          watchlistId: 'watchlist-1',
        },
        currentLabels,
      })
    ).toEqual([
      {
        kind: 'current_workflow',
        workflowId: 'workflow-pair',
        workspaceId: 'workspace-1',
        label: 'Localized Workflow',
      },
      {
        kind: 'current_skill',
        skillId: 'skill-1',
        workspaceId: 'workspace-1',
        label: 'Localized Skill',
      },
      {
        kind: 'current_watchlist',
        watchlistId: 'watchlist-1',
        workspaceId: 'workspace-1',
        label: 'Localized Watchlist',
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
        currentLabels,
      })
    ).toEqual([
      {
        kind: 'current_workflow',
        workflowId: 'workflow-pair',
        workspaceId: 'workspace-1',
        label: 'Localized Workflow',
      },
    ])
  })

  it('does not emit current context without selected entity ids', () => {
    expect(
      buildImplicitCopilotContexts({
        workspaceId: 'workspace-1',
        pairContext: {},
        currentLabels,
      })
    ).toEqual([])
  })
})
