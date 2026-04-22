import { describe, expect, it } from 'vitest'
import {
  buildCopilotWorkspaceEntityContext,
  getCopilotWorkspaceEntityIdFromPairContext,
  getCopilotWorkspaceEntityKindFromContext,
  matchesCopilotWorkspaceEntityContext,
  readCopilotWorkspaceEntityContext,
} from './workspace-entities'

describe('workspace-entities', () => {
  it('builds current workflow context from centralized metadata', () => {
    expect(
      buildCopilotWorkspaceEntityContext({
        entityKind: 'workflow',
        entityId: 'workflow-1',
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
      current: false,
    })

    expect(
      readCopilotWorkspaceEntityContext({
        kind: 'current_skill',
        skillId: 'skill-1',
        workspaceId: 'workspace-1',
        label: 'Current Skill',
      })
    ).toEqual({
      entityKind: 'skill',
      entityId: 'skill-1',
      workspaceId: 'workspace-1',
      current: true,
    })
  })

  it('reads entity ids from pair context consistently', () => {
    expect(
      getCopilotWorkspaceEntityIdFromPairContext(
        {
          workflowId: 'workflow-1',
          customToolId: 'tool-1',
        },
        'workflow'
      )
    ).toBe('workflow-1')

    expect(
      getCopilotWorkspaceEntityIdFromPairContext(
        {
          workflowId: 'workflow-1',
          customToolId: 'tool-1',
        },
        'custom_tool'
      )
    ).toBe('tool-1')
  })
})
