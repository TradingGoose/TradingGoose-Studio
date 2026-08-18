import { describe, expect, it } from 'vitest'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { buildCopilotWorkspaceEntityContext } from '@/lib/copilot/workspace-entities'
import {
  buildTurnProvenanceFromContexts,
  withPinnedToolExecutionProvenance,
} from './store-provenance'

describe('buildTurnProvenanceFromContexts', () => {
  it('derives workflow scope from an explicit workflow mention', () => {
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
        null
      )
    ).toEqual({
      contextEntityKind: 'workflow',
      contextEntityId: 'workflow-explicit',
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
        'workspace-live'
      )
    ).toEqual({
      contextEntityKind: 'watchlist',
      contextEntityId: 'watchlist-1',
      workspaceId: 'workspace-1',
    })
  })

  it('uses current knowledge context without overriding workspace scope', () => {
    expect(
      buildTurnProvenanceFromContexts(
        [
          {
            kind: 'current_knowledge_base',
            knowledgeBaseId: 'knowledge-current',
            workspaceId: 'workspace-current',
            label: 'Current Knowledge Base',
          },
        ],
        'workspace-live'
      )
    ).toEqual({
      contextEntityKind: 'knowledge_base',
      contextEntityId: 'knowledge-current',
      workspaceId: 'workspace-live',
    })
  })

  it('keeps an attached entity scope while dashboard tools use the current dashboard scope', () => {
    const provenance = buildTurnProvenanceFromContexts(
      [
        buildCopilotWorkspaceEntityContext({
          entityKind: 'watchlist',
          entityId: 'watchlist-current',
          workspaceId: 'workspace-1',
          label: 'Attached Watchlist',
        }),
        {
          kind: 'current_dashboard_layout',
          dashboardLayoutId: 'layout-current',
          workspaceId: 'workspace-1',
          ownerUserId: 'user-1',
          label: 'Current Dashboard',
        },
      ],
      'workspace-1'
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
