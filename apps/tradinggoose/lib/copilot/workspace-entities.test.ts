import { describe, expect, it } from 'vitest'
import {
  buildCopilotWorkspaceEntityContext,
  readCopilotWorkspaceEntityContext,
} from './workspace-entities'

describe('workspace-entities', () => {
  it('builds explicit workspace entity contexts with workspace ids', () => {
    expect(
      buildCopilotWorkspaceEntityContext({
        entityKind: 'knowledge_base',
        entityId: 'knowledge-1',
        workspaceId: 'workspace-1',
        label: 'Research',
      })
    ).toEqual({
      kind: 'knowledge_base',
      knowledgeBaseId: 'knowledge-1',
      workspaceId: 'workspace-1',
      label: 'Research',
    })

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
  })

  it('reads shared workspace entity context details consistently', () => {
    expect(
      readCopilotWorkspaceEntityContext({
        kind: 'current_knowledge_base',
        knowledgeBaseId: 'knowledge-1',
        workspaceId: 'workspace-1',
        label: 'Current Knowledge Base',
      })
    ).toEqual({
      entityKind: 'knowledge_base',
      entityId: 'knowledge-1',
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
})
