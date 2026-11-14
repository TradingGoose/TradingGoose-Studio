import { describe, expect, it } from 'vitest'
import { buildCopilotWorkspaceEntityContext } from '@/lib/copilot/workspace-entities'
import { buildTurnProvenanceFromContexts } from './store-provenance'

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
    ).toMatchObject({
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
    ).toMatchObject({
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
    ).toMatchObject({
      contextEntityKind: 'knowledge_base',
      contextEntityId: 'knowledge-current',
      workspaceId: 'workspace-live',
    })
  })

  it('keeps the primary attached entity without duplicating per-tool dashboard context', () => {
    expect(
      buildTurnProvenanceFromContexts(
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
    ).toEqual({
      contextEntityKind: 'watchlist',
      contextEntityId: 'watchlist-current',
      workspaceId: 'workspace-1',
    })
  })
})
