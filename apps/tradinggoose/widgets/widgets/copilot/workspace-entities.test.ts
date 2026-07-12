import { describe, expect, it } from 'vitest'
import {
  buildCopilotWorkspaceEntityContext,
  COPILOT_EFFECTIVE_PARAM_ENTITY_CONFIGS,
  COPILOT_WORKSPACE_ENTITY_MENTION_CONFIGS,
  getCopilotWorkspaceEntityIdFromEffectiveParams,
  getCopilotWorkspaceEntityKindFromContext,
  matchesCopilotWorkspaceEntityContext,
  readCopilotWorkspaceEntityContext,
} from './workspace-entities'

describe('workspace-entities', () => {
  it('keeps dashboard layouts mentionable but out of effective-param entity configs', () => {
    expect(COPILOT_WORKSPACE_ENTITY_MENTION_CONFIGS.map((config) => config.entityKind)).toContain(
      'dashboard_layout'
    )
    expect(COPILOT_EFFECTIVE_PARAM_ENTITY_CONFIGS.map((config) => config.entityKind)).not.toContain(
      'dashboard_layout'
    )
  })

  it('builds current workflow context from centralized metadata', () => {
    expect(
      buildCopilotWorkspaceEntityContext({
        entityKind: 'workflow',
        entityId: 'workflow-1',
        label: 'Current Workflow',
        current: true,
      })
    ).toEqual({
      kind: 'current_workflow',
      workflowId: 'workflow-1',
      label: 'Current Workflow',
    })
  })

  it('builds explicit workspace entity contexts with workspace ids', () => {
    expect(
      buildCopilotWorkspaceEntityContext({
        entityKind: 'workflow',
        entityId: 'workflow-1',
        workspaceId: 'workspace-1',
        label: 'Primary Workflow',
      })
    ).toEqual({
      kind: 'workflow',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      label: 'Primary Workflow',
    })

    expect(
      buildCopilotWorkspaceEntityContext({
        entityKind: 'skill',
        entityId: 'skill-1',
        workspaceId: 'workspace-1',
        label: 'Risk Filter',
      })
    ).toEqual({
      kind: 'skill',
      skillId: 'skill-1',
      workspaceId: 'workspace-1',
      label: 'Risk Filter',
    })

    expect(
      buildCopilotWorkspaceEntityContext({
        entityKind: 'watchlist',
        entityId: 'watchlist-1',
        workspaceId: 'workspace-1',
        label: 'Growth',
      })
    ).toEqual({
      kind: 'watchlist',
      watchlistId: 'watchlist-1',
      workspaceId: 'workspace-1',
      label: 'Growth',
    })
  })

  it('normalizes current and explicit contexts back to the same base entity kind', () => {
    expect(
      getCopilotWorkspaceEntityKindFromContext({
        kind: 'current_indicator',
      } as any)
    ).toBe('indicator')

    expect(
      getCopilotWorkspaceEntityKindFromContext({
        kind: 'custom_tool',
      } as any)
    ).toBe('custom_tool')
  })

  it('matches explicit contexts against entity kind and id', () => {
    const context = buildCopilotWorkspaceEntityContext({
      entityKind: 'mcp_server',
      entityId: 'mcp-1',
      workspaceId: 'workspace-1',
      label: 'Broker MCP',
    })

    expect(matchesCopilotWorkspaceEntityContext(context, 'mcp_server', 'mcp-1')).toBe(true)
    expect(matchesCopilotWorkspaceEntityContext(context, 'mcp_server', 'mcp-2')).toBe(false)
  })

  it('reads shared workspace entity context details consistently', () => {
    expect(
      readCopilotWorkspaceEntityContext({
        kind: 'workflow',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        label: 'Primary Workflow',
      })
    ).toEqual({
      entityKind: 'workflow',
      entityId: 'workflow-1',
      workspaceId: 'workspace-1',
      ownerUserId: null,
      current: false,
    })

    expect(
      readCopilotWorkspaceEntityContext({
        kind: 'current_watchlist',
        watchlistId: 'watchlist-1',
        workspaceId: 'workspace-1',
        label: 'Current Watchlist',
      })
    ).toEqual({
      entityKind: 'watchlist',
      entityId: 'watchlist-1',
      workspaceId: 'workspace-1',
      ownerUserId: null,
      current: true,
    })

    expect(
      readCopilotWorkspaceEntityContext({
        kind: 'dashboard_layout',
        dashboardLayoutId: 'layout-1',
        workspaceId: 'workspace-1',
        ownerUserId: 'user-1',
        label: 'Trading Desk',
      })
    ).toEqual({
      entityKind: 'dashboard_layout',
      entityId: 'layout-1',
      workspaceId: 'workspace-1',
      ownerUserId: 'user-1',
      current: false,
    })
  })

  it('reads entity ids from effective params consistently', () => {
    expect(
      getCopilotWorkspaceEntityIdFromEffectiveParams(
        {
          workflowId: 'workflow-1',
          customToolId: 'tool-1',
        },
        'workflow'
      )
    ).toBe('workflow-1')

    expect(
      getCopilotWorkspaceEntityIdFromEffectiveParams(
        {
          workflowId: 'workflow-1',
          customToolId: 'tool-1',
          watchlistId: 'watchlist-1',
        },
        'custom_tool'
      )
    ).toBe('tool-1')

    expect(
      getCopilotWorkspaceEntityIdFromEffectiveParams(
        {
          workflowId: 'workflow-1',
          customToolId: 'tool-1',
          watchlistId: 'watchlist-1',
        },
        'watchlist'
      )
    ).toBe('watchlist-1')
  })
})
