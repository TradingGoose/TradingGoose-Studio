/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { useFilterStore } from './store'

const resetFilterStore = () => {
  useFilterStore.setState({
    logs: [],
    workspaceId: '',
    viewMode: 'logs',
    timeRange: 'All time',
    level: 'all',
    workflowIds: [],
    folderIds: [],
    searchQuery: '',
    triggers: [],
    loading: true,
    error: null,
    page: 1,
    hasMore: true,
    isFetchingMore: false,
    _isInitializing: false,
  })
}

describe('logs filter store', () => {
  beforeEach(() => {
    resetFilterStore()
    window.history.replaceState({}, '', '/workspace/ws-1/logs')
  })

  it('drops unknown view values back to the logs surface', () => {
    window.history.replaceState({}, '', '/workspace/ws-1/logs?view=invalid&timeRange=past-24-hours')

    useFilterStore.getState().initializeFromURL()

    expect(useFilterStore.getState().viewMode).toBe('logs')
    expect(window.location.search).toBe('?timeRange=past-24-hours')
    expect(window.location.search).not.toContain('view=')
  })
})
