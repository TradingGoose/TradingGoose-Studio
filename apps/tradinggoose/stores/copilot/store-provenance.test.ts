import { describe, expect, it } from 'vitest'
import { buildCopilotWorkspaceEntityContext } from '@/widgets/widgets/copilot/workspace-entities'
import { buildTurnProvenanceFromContexts } from './store-provenance'

describe('buildTurnProvenanceFromContexts', () => {
  it('derives workflow scope from an explicit workflow mention when no live workflow is pinned', () => {
    expect(
      buildTurnProvenanceFromContexts(
        [
          buildCopilotWorkspaceEntityContext({
            entityKind: 'workflow',
            entityId: 'workflow-explicit',
            workspaceId: 'workspace-1',
            label: 'Attached Workflow',
          }),
        ],
        null,
        null,
        null
      )
    ).toEqual({
      contextWorkflowId: 'workflow-explicit',
      workspaceId: 'workspace-1',
    })
  })

  it('keeps the live workflow scope ahead of attached workflow mentions', () => {
    expect(
      buildTurnProvenanceFromContexts(
        [
          buildCopilotWorkspaceEntityContext({
            entityKind: 'workflow',
            entityId: 'workflow-explicit',
            workspaceId: 'workspace-1',
            label: 'Attached Workflow',
          }),
        ],
        'workspace-1',
        null,
        'workflow-live'
      )
    ).toEqual({
      contextWorkflowId: 'workflow-live',
      workspaceId: 'workspace-1',
    })
  })
})
