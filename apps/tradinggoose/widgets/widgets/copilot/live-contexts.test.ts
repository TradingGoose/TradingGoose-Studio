import { describe, expect, it } from 'vitest'
import { buildImplicitCopilotContexts, resolveCopilotWorkflowId } from './live-contexts'

const currentLabels = {
  workflow: 'Localized Workflow',
  skill: 'Localized Skill',
  custom_tool: 'Localized Tool',
  indicator: 'Localized Indicator',
  mcp_server: 'Localized MCP Server',
  watchlist: 'Localized Watchlist',
  dashboard_layout: 'Localized Dashboard Layout',
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

  it('uses pair workflow id without adding a synthetic watchlist context', () => {
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

  it('does not emit a watchlist context without a selected watchlist entity id', () => {
    expect(
      buildImplicitCopilotContexts({
        workspaceId: 'workspace-1',
        pairContext: {},
        currentLabels,
      })
    ).toEqual([])
  })

  it('emits current dashboard layout explicitly outside pair-derived contexts', () => {
    expect(
      buildImplicitCopilotContexts({
        workspaceId: 'workspace-1',
        currentLayoutId: 'layout-1',
        currentLayoutOwnerUserId: 'user-1',
        pairContext: {},
        currentLabels,
      })
    ).toEqual([
      {
        kind: 'current_dashboard_layout',
        dashboardLayoutId: 'layout-1',
        workspaceId: 'workspace-1',
        ownerUserId: 'user-1',
        label: 'Localized Dashboard Layout',
      },
    ])
  })
})
