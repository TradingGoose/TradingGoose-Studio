import { describe, expect, it } from 'vitest'
import { buildImplicitCopilotContexts, resolveCopilotWorkflowId } from './live-contexts'

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
