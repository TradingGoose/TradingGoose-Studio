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
      contextEntityKind: 'workflow',
      contextEntityId: 'workflow-explicit',
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
        'workflow-live',
        null
      )
    ).toEqual({
      contextEntityKind: 'workflow',
      contextEntityId: 'workflow-live',
      workspaceId: 'workspace-1',
    })
  })

  it('keeps review target identity out of execution provenance', () => {
    expect(
      buildTurnProvenanceFromContexts(
        [
          buildCopilotWorkspaceEntityContext({
            entityKind: 'workflow',
            entityId: 'workflow-explicit',
            workspaceId: 'workspace-explicit',
            label: 'Attached Workflow',
          }),
        ],
        'workspace-live',
        null,
        {
          workspaceId: 'workspace-review',
          entityKind: 'skill',
          entityId: 'skill-review',
          draftSessionId: null,
          reviewSessionId: 'review-1',
          yjsSessionId: 'review-1',
        }
      )
    ).toEqual({
      workspaceId: 'workspace-review',
      contextEntityKind: 'workflow',
      contextEntityId: 'workflow-explicit',
    })
  })

  it('does not synthesize workspace provenance for incomplete non-workflow review targets', () => {
    expect(
      buildTurnProvenanceFromContexts(undefined, null, null, {
        workspaceId: null,
        entityKind: 'skill',
        entityId: 'skill-review',
        draftSessionId: null,
        reviewSessionId: 'review-1',
        yjsSessionId: 'review-1',
      })
    ).toBeUndefined()
  })
})
