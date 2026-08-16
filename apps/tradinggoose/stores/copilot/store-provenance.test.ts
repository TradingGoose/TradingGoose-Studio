import { describe, expect, it } from 'vitest'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { buildCopilotWorkspaceEntityContext } from '@/lib/copilot/workspace-entities'
import {
  buildTurnProvenanceFromContexts,
  withPinnedToolExecutionProvenance,
} from './store-provenance'

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
        'workflow-live'
      )
    ).toEqual({
      contextEntityKind: 'workflow',
      contextEntityId: 'workflow-live',
      workspaceId: 'workspace-1',
    })
  })

  it('lets explicit saved-entity scope override the ambient workspace', () => {
    expect(
      buildTurnProvenanceFromContexts(
        [
          buildCopilotWorkspaceEntityContext({
            entityKind: 'watchlist',
            entityId: 'watchlist-1',
            workspaceId: 'workspace-1',
            label: 'Growth',
          }),
        ],
        'workspace-live',
        null
      )
    ).toEqual({
      contextEntityKind: 'watchlist',
      contextEntityId: 'watchlist-1',
      workspaceId: 'workspace-1',
    })
  })

  it('uses current watchlist contexts as implicit entity provenance without overriding workspace scope', () => {
    expect(
      buildTurnProvenanceFromContexts(
        [
          buildCopilotWorkspaceEntityContext({
            entityKind: 'watchlist',
            entityId: 'workspace-current',
            workspaceId: 'workspace-current',
            label: 'Current Watchlist',
            current: true,
          }),
        ],
        'workspace-live',
        null
      )
    ).toEqual({
      contextEntityKind: 'watchlist',
      contextEntityId: 'workspace-current',
      workspaceId: 'workspace-live',
    })
  })

  it('keeps current watchlist provenance while dashboard tools use the dashboard scope', () => {
    const provenance = buildTurnProvenanceFromContexts(
      [
        buildCopilotWorkspaceEntityContext({
          entityKind: 'watchlist',
          entityId: 'watchlist-current',
          workspaceId: 'workspace-1',
          label: 'Current Watchlist',
          current: true,
        }),
        buildCopilotWorkspaceEntityContext({
          entityKind: 'dashboard_layout',
          entityId: 'layout-current',
          workspaceId: 'workspace-1',
          ownerUserId: 'user-1',
          label: 'Current Dashboard',
          current: true,
        }),
      ],
      'workspace-1',
      null
    )

    expect(provenance).toEqual({
      contextEntityKind: 'watchlist',
      contextEntityId: 'watchlist-current',
      workspaceId: 'workspace-1',
      dashboardLayoutContext: {
        entityId: 'layout-current',
        workspaceId: 'workspace-1',
        ownerUserId: 'user-1',
      },
    })

    expect(
      withPinnedToolExecutionProvenance(
        {
          id: 'tool-1',
          name: 'read_watchlist',
          state: ClientToolCallState.pending,
        },
        provenance
      ).provenance
    ).toEqual({
      contextEntityKind: 'watchlist',
      contextEntityId: 'watchlist-current',
      workspaceId: 'workspace-1',
    })

    expect(
      withPinnedToolExecutionProvenance(
        {
          id: 'tool-2',
          name: 'edit_widget',
          state: ClientToolCallState.pending,
        },
        provenance
      ).provenance
    ).toEqual({
      contextEntityKind: 'dashboard_layout',
      contextEntityId: 'layout-current',
      workspaceId: 'workspace-1',
    })
  })
})
