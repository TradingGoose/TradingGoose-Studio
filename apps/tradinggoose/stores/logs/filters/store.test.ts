/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { useFilterStore } from './store'

const resetFilterStore = () => {
  useFilterStore.setState({
    logs: [],
    workspaceId: '',
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
    window.history.replaceState({}, '', '/workspace/ws-1/records')
  })

  it('preserves records-owned params while syncing log filters', () => {
    window.history.replaceState(
      {},
      '',
      '/workspace/ws-1/records?tab=logs&timeRange=past-24-hours&orderSearch=AAPL&orderSortBy=provider'
    )

    useFilterStore.getState().initializeFromURL()

    const params = new URLSearchParams(window.location.search)
    expect(params.get('tab')).toBe('logs')
    expect(params.get('timeRange')).toBe('past-24-hours')
    expect(params.get('orderSearch')).toBe('AAPL')
    expect(params.get('orderSortBy')).toBe('provider')
  })

  it('canonicalizes default records tab values during log filter sync', () => {
    window.history.replaceState(
      {},
      '',
      '/workspace/ws-1/records?tab=orders&orderSearch=TSLA&level=error'
    )

    useFilterStore.getState().initializeFromURL()

    const params = new URLSearchParams(window.location.search)
    expect(params.has('tab')).toBe(false)
    expect(params.get('orderSearch')).toBe('TSLA')
    expect(params.get('level')).toBe('error')
  })

  it('preserves the full records order filter model while syncing log filters', () => {
    window.history.replaceState(
      {},
      '',
      [
        '/workspace/ws-1/records?tab=logs',
        'orderSearch=AAPL',
        'orderSortBy=side',
        'orderSortOrder=asc',
        'provider=alpaca',
        'environment=paper',
        'submissionSource=workflow',
        'status=filled',
        'side=buy',
        'orderType=limit',
        'timeInForce=day',
        'linkedLog=true',
        'startDate=2026-04-23T00%3A00%3A00.000Z',
        'endDate=2026-04-24T00%3A00%3A00.000Z',
        'timeRange=past-hour',
        'level=info',
        'workflowIds=workflow-1,workflow-2',
        'folderIds=folder-1',
        'triggers=manual,chat',
        'search=failed%20order',
      ].join('&')
    )

    useFilterStore.getState().initializeFromURL()

    const state = useFilterStore.getState()
    expect(state.timeRange).toBe('Past hour')
    expect(state.level).toBe('info')
    expect(state.workflowIds).toEqual(['workflow-1', 'workflow-2'])
    expect(state.folderIds).toEqual(['folder-1'])
    expect(state.triggers).toEqual(['manual', 'chat'])
    expect(state.searchQuery).toBe('failed order')

    const params = new URLSearchParams(window.location.search)
    expect(params.get('tab')).toBe('logs')
    expect(params.get('orderSearch')).toBe('AAPL')
    expect(params.get('orderSortBy')).toBe('side')
    expect(params.get('orderSortOrder')).toBe('asc')
    expect(params.get('provider')).toBe('alpaca')
    expect(params.get('environment')).toBe('paper')
    expect(params.get('submissionSource')).toBe('workflow')
    expect(params.get('status')).toBe('filled')
    expect(params.get('side')).toBe('buy')
    expect(params.get('orderType')).toBe('limit')
    expect(params.get('timeInForce')).toBe('day')
    expect(params.get('linkedLog')).toBe('true')
    expect(params.get('startDate')).toBe('2026-04-23T00:00:00.000Z')
    expect(params.get('endDate')).toBe('2026-04-24T00:00:00.000Z')
  })
})
