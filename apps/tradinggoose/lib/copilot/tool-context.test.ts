import { describe, expect, it } from 'vitest'
import { collectCopilotToolContexts, resolveCopilotToolContext } from './tool-context'

const dashboard = {
  contextEntityKind: 'dashboard_layout',
  contextEntityId: 'layout-a',
  workspaceId: 'workspace-a',
} as const
const watchlist = {
  contextEntityKind: 'watchlist',
  contextEntityId: 'watchlist-b',
  workspaceId: 'workspace-b',
} as const

describe('per-tool conversation context', () => {
  it('keeps dashboard and explicit entity targets in their own workspace', () => {
    expect(resolveCopilotToolContext('edit_widget', {}, watchlist, [dashboard, watchlist])).toEqual(
      dashboard
    )
    expect(
      resolveCopilotToolContext('read_watchlist', { entityId: 'watchlist-b' }, dashboard, [
        dashboard,
        watchlist,
      ])
    ).toEqual(watchlist)
  })
  it('clears unrelated workspace context for an explicit target discovered during the run', () => {
    expect(
      resolveCopilotToolContext('read_workflow', { entityId: 'new-workflow' }, dashboard, [
        dashboard,
      ])
    ).toEqual({ contextEntityKind: 'workflow', contextEntityId: 'new-workflow' })
  })
  it('preserves explicit workspace arguments and keeps browser-only flows on the primary context', () => {
    expect(
      resolveCopilotToolContext('create_workflow', { workspaceId: 'new-workspace' }, watchlist)
    ).toMatchObject({ workspaceId: 'new-workspace' })
    expect(resolveCopilotToolContext('oauth_request_access', {}, watchlist, [dashboard])).toEqual(
      watchlist
    )
  })
  it('collects the dashboard separately and deduplicates repeated entity mentions', () => {
    expect(
      collectCopilotToolContexts([
        {
          kind: 'current_dashboard_layout',
          dashboardLayoutId: 'layout-a',
          workspaceId: 'workspace-a',
          ownerUserId: 'actor',
          label: 'Current',
        },
        { kind: 'watchlist', watchlistId: 'watchlist-b', workspaceId: 'workspace-b', label: 'B' },
        {
          kind: 'watchlist',
          watchlistId: 'watchlist-b',
          workspaceId: 'workspace-b',
          label: 'Again',
        },
      ])
    ).toEqual([dashboard, watchlist])
  })
})
