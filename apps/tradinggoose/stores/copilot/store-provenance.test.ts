import { describe, expect, it } from 'vitest'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { buildCopilotWorkspaceEntityContext } from '@/widgets/widgets/copilot/workspace-entities'
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

  it('derives saved-entity scope from explicit watchlist mentions', () => {
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
        null,
        null,
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
        null,
        null
      )
    ).toEqual({
      contextEntityKind: 'watchlist',
      contextEntityId: 'workspace-current',
      workspaceId: 'workspace-live',
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
          ownerUserId: null,
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
        ownerUserId: null,
        entityKind: 'skill',
        entityId: 'skill-review',
        draftSessionId: null,
        reviewSessionId: 'review-1',
        yjsSessionId: 'review-1',
      })
    ).toBeUndefined()
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
      null,
      null,
      'user-1'
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

  it('keeps the dashboard layout candidate for dashboard tool pinning', () => {
    expect(
      buildTurnProvenanceFromContexts(
        [
          buildCopilotWorkspaceEntityContext({
            entityKind: 'dashboard_layout',
            entityId: 'layout-other',
            workspaceId: 'workspace-1',
            ownerUserId: 'user-2',
            label: 'Other Dashboard',
            current: true,
          }),
        ],
        'workspace-1',
        null,
        null,
        'user-1'
      )
    ).toEqual({
      workspaceId: 'workspace-1',
      dashboardLayoutContext: {
        entityId: 'layout-other',
        workspaceId: 'workspace-1',
        ownerUserId: 'user-2',
      },
    })
  })
})
