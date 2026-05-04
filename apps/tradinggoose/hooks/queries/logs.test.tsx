/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildLogsRequestParams, useLogsList } from '@/hooks/queries/logs'

const baseFilters = {
  timeRange: 'All time',
  level: 'all',
  workflowIds: [],
  folderIds: [],
  triggers: [],
  searchQuery: '',
  limit: 100,
}

function LogsHarness() {
  useLogsList('workspace-1', {
    ...baseFilters,
    details: 'full',
    triggerSource: 'indicator_trigger',
  })
  return null
}

describe('useLogsList', () => {
  let container: HTMLDivElement
  let root: Root
  let queryClient: QueryClient

  const flushAsyncWork = async () => {
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: 0,
        },
      },
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    global.fetch = vi.fn(async () =>
      Response.json({
        data: [],
        page: 1,
        totalPages: 1,
      })
    )
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    queryClient.clear()
    container.remove()
    vi.restoreAllMocks()
  })

  it('serializes full log details requests into the logs API query string', async () => {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <LogsHarness />
        </QueryClientProvider>
      )
    })

    await act(async () => {
      await flushAsyncWork()
    })

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const rawUrl = String(vi.mocked(global.fetch).mock.calls[0]?.[0])
    const url = new URL(rawUrl, 'http://localhost')

    expect(url.pathname).toBe('/api/logs')
    expect(url.searchParams.get('workspaceId')).toBe('workspace-1')
    expect(url.searchParams.get('details')).toBe('full')
    expect(url.searchParams.get('triggerSource')).toBe('indicator_trigger')
  })

  it('builds export params from parsed search syntax without list-only params', () => {
    const rawParams = buildLogsRequestParams(
      'workspace-1',
      {
        ...baseFilters,
        searchQuery: 'workflow:"Workflow One"',
        triggerSource: 'indicator_trigger',
      },
      {
        includePagination: false,
        includeDetails: false,
      }
    )
    const params = new URLSearchParams(rawParams)

    expect(params.get('workspaceId')).toBe('workspace-1')
    expect(params.get('workflowName')).toBe('Workflow One')
    expect(params.get('triggerSource')).toBe('indicator_trigger')
    expect(params.has('search')).toBe(false)
    expect(params.has('limit')).toBe(false)
    expect(params.has('details')).toBe(false)
  })
})
